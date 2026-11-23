#!/usr/bin/env bash
# Instala o ditado local do Co-Dev: constrói o whisper.cpp e descarrega um modelo para
# ~/.local/share/dxtutor/whisper (onde a app o procura — src-tauri/src/dictation.rs).
#
#   scripts/setup-whisper.sh [modelo]
#
# modelo: large-v3-turbo-q5_0 (por omissão, ~550 MB — o melhor em português: ~9% de erro
#         contra ~16% do small nas medições do Co-Dev), small (3x mais rápido em CPU),
#         base, medium, tiny, …
#
# GPU: com os cabeçalhos Vulkan e o glslc instalados (Ubuntu/Debian:
# `sudo apt install libvulkan-dev glslc`), compila com Vulkan — NVIDIA, AMD e Intel; o
# ditado passa de segundos para menos de um. Sem eles, compila para CPU. Os SPIRV-Headers
# (`spirv-headers` no apt) vêm do GitHub para a pasta acima se o sistema não os tiver.
# Variáveis: WHISPER_TAG (versão do whisper.cpp), DXTUTOR_WHISPER_DIR (pasta de destino).
#
# Nada é instalado no sistema: o binário fica na pasta acima; se não houver cmake, vem do
# pip para um venv dentro da mesma pasta. O áudio do ditado nunca sai da máquina.
set -euo pipefail

MODEL="${1:-large-v3-turbo-q5_0}"
TAG="${WHISPER_TAG:-v1.9.5}"
DIR="${DXTUTOR_WHISPER_DIR:-$HOME/.local/share/dxtutor/whisper}"
SRC="$DIR/whisper.cpp"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "falta '$1' — instala-o e volta a correr" >&2; exit 1; }; }

case "$MODEL" in
  *[!a-z0-9.\-_]*|"") echo "nome de modelo inválido: $MODEL" >&2; exit 1 ;;
esac
need git; need curl; need c++

mkdir -p "$DIR"

if command -v cmake >/dev/null 2>&1; then
  CMAKE=cmake
else
  need python3
  if [ ! -x "$DIR/.venv/bin/cmake" ]; then
    say "sem cmake no sistema: a instalar no venv $DIR/.venv"
    python3 -m venv "$DIR/.venv"
    "$DIR/.venv/bin/pip" install --quiet --disable-pip-version-check cmake
  fi
  CMAKE="$DIR/.venv/bin/cmake"
fi

if [ ! -d "$SRC/.git" ]; then
  say "a obter o whisper.cpp $TAG"
  git clone --quiet --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$SRC"
else
  say "whisper.cpp já obtido em $SRC ($(git -C "$SRC" describe --tags 2>/dev/null || echo '?'))"
fi

GPU=OFF
PREFIX=""
if command -v glslc >/dev/null 2>&1 && { [ -f /usr/include/vulkan/vulkan.h ] || [ -n "${VULKAN_SDK:-}" ]; }; then
  GPU=ON
  say "Vulkan encontrado: a compilar com GPU"
  # o ggml-vulkan pede o pacote CMake dos SPIRV-Headers (só cabeçalhos)
  if ! find /usr/share /usr/lib /usr/local ${VULKAN_SDK:+"$VULKAN_SDK"} -name 'SPIRV-HeadersConfig.cmake' -print -quit 2>/dev/null | grep -q .; then
    DEPS="$DIR/deps"
    if [ ! -f "$DEPS/share/cmake/SPIRV-Headers/SPIRV-HeadersConfig.cmake" ]; then
      say "a obter os SPIRV-Headers para $DEPS"
      rm -rf "$DIR/spirv-headers"
      git clone --quiet --depth 1 --branch "${SPIRV_TAG:-vulkan-sdk-1.3.296.0}" https://github.com/KhronosGroup/SPIRV-Headers "$DIR/spirv-headers"
      "$CMAKE" -S "$DIR/spirv-headers" -B "$DIR/spirv-headers/build" -DCMAKE_INSTALL_PREFIX="$DEPS" -DSPIRV_HEADERS_ENABLE_TESTS=OFF >/dev/null
      "$CMAKE" --install "$DIR/spirv-headers/build" >/dev/null
    fi
    PREFIX="$DEPS"
  fi
else
  say "sem Vulkan (libvulkan-dev + glslc): a compilar para CPU — para GPU: sudo apt install libvulkan-dev glslc"
fi
say "a compilar o whisper-cli (Release, estático)"
"$CMAKE" -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DGGML_VULKAN="$GPU" \
  ${PREFIX:+-DCMAKE_PREFIX_PATH="$PREFIX"} ${PREFIX:+-DCMAKE_CXX_FLAGS="-isystem $PREFIX/include"} >/dev/null
# (o whisper.cpp v1.9.x encontra os SPIRV-Headers no CMake mas não lhes junta o include:
#  conta com eles em /usr/include, como no pacote do apt — daí o -isystem acima)
"$CMAKE" --build "$SRC/build" --config Release -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" --target whisper-cli >/dev/null
BIN="$SRC/build/bin/whisper-cli"
[ -x "$BIN" ] || { echo "a compilação não produziu $BIN" >&2; exit 1; }

OUT="$DIR/ggml-$MODEL.bin"
if [ -s "$OUT" ]; then
  say "modelo já presente: $OUT"
else
  say "a descarregar o modelo ggml-$MODEL.bin"
  curl -fL --progress-bar -o "$OUT.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  mv "$OUT.part" "$OUT"
fi

# GPU: escolher a dedicada (uma: 0) entre as que o Vulkan vê — por omissão o whisper usa a
# 0, que num portátil é a integrada (mais lenta do que a CPU). A transcrição de teste também
# deixa os shaders compilados na cache do driver (a 1.ª vez demora alguns segundos).
rm -f "$DIR/gpu-device"
if [ "$GPU" = ON ]; then
  PROBE=$("$BIN" -m "$OUT" -f "$SRC/samples/jfk.wav" -l en -ac 768 -nt 2>&1 >/dev/null || true)
  DEV=$(printf '%s\n' "$PROBE" | sed -n 's/^ggml_vulkan: \([0-9]\+\) = \(.*\) | uma: 0.*/\1\t\2/p' | head -1)
  if [ -n "$DEV" ]; then
    printf '%s\n' "${DEV%%$'\t'*}" > "$DIR/gpu-device"
    say "GPU dedicada: ${DEV#*$'\t'} (dispositivo ${DEV%%$'\t'*})"
    "$BIN" -m "$OUT" -f "$SRC/samples/jfk.wav" -l en -ac 768 -nt -np -dev "${DEV%%$'\t'*}" >/dev/null 2>&1 || true
  else
    say "sem GPU dedicada: o whisper usa a GPU por omissão"
  fi
fi

say "pronto: $BIN"
say "        $OUT"
echo "No Co-Dev, clica no microfone do compositor para ditar (clica outra vez para transcrever)."
