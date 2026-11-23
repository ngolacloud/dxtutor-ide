#!/usr/bin/env bash
# Instala o ditado local do Co-Dev: constrói o whisper.cpp e descarrega um modelo para
# ~/.local/share/dxtutor/whisper (onde a app o procura — src-tauri/src/dictation.rs).
#
#   scripts/setup-whisper.sh [modelo]
#
# modelo: small (por omissão — bom em português), base (mais rápido), medium,
#         large-v3-turbo-q5_0 (melhor qualidade, ~550 MB), tiny, …
# Variáveis: WHISPER_TAG (versão do whisper.cpp), DXTUTOR_WHISPER_DIR (pasta de destino).
#
# Nada é instalado no sistema: o binário fica na pasta acima; se não houver cmake, vem do
# pip para um venv dentro da mesma pasta. O áudio do ditado nunca sai da máquina.
set -euo pipefail

MODEL="${1:-small}"
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

say "a compilar o whisper-cli (Release, estático)"
"$CMAKE" -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null
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

say "pronto: $BIN"
say "        $OUT"
echo "No Co-Dev, clica no microfone do compositor para ditar (clica outra vez para transcrever)."
