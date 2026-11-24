#!/usr/bin/env python3
"""Gera os cursos embutidos da UI (ui-app/src/content/courses/<lang>.json) a partir dos
cursos canónicos dos plugins oficiais (courses/<lang>/courses/<lang>.toml).

O JSON da UI é uma PROJECÇÃO do TOML: mesmo conteúdo, sem os campos de toolchain que só o
backend usa (`install_commands`, `run_command`, `dependencies`) nem `language`/`level` do curso,
e com `unit`/`step` renomeados para `units`/`steps`. Editar sempre o TOML e correr:

    python3 scripts/sync-ui-courses.py          # reescreve os JSON
    python3 scripts/sync-ui-courses.py --check  # só verifica (sai 1 se divergirem)

O teste Rust `ui_json_e_projeccao_do_toml` (crates/tutor-core) falha se alguém editar um sem
o outro. Requer Python 3.11+ (tomllib).
"""
import json
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES = {"rust": "rust", "go": "go"}  # língua → pasta do plugin em courses/
BACKEND_ONLY_STEP = {"install_commands", "run_command", "dependencies"}
BACKEND_ONLY_COURSE = {"language", "level"}


def project(course: dict) -> dict:
    out = {}
    for k, v in course.items():
        if k in BACKEND_ONLY_COURSE:
            continue
        if k == "unit":
            out["units"] = [project_unit(u) for u in v]
        else:
            out[k] = v
    return out


def project_unit(unit: dict) -> dict:
    out = {}
    for k, v in unit.items():
        if k == "step":
            out["steps"] = [{sk: sv for sk, sv in s.items() if sk not in BACKEND_ONLY_STEP} for s in v]
        else:
            out[k] = v
    return out


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for lang, folder in COURSES.items():
        src = ROOT / "courses" / folder / "courses" / f"{lang}.toml"
        dst = ROOT / "ui-app" / "src" / "content" / "courses" / f"{lang}.json"
        text = json.dumps(project(tomllib.loads(src.read_text("utf-8"))), ensure_ascii=False, indent=1) + "\n"
        if dst.exists() and dst.read_text("utf-8") == text:
            continue
        stale.append(dst.relative_to(ROOT))
        if not check:
            dst.write_text(text, "utf-8")
    if check and stale:
        print("out of date (run python3 scripts/sync-ui-courses.py):", *stale, sep="\n  ")
        return 1
    for p in stale:
        print("wrote", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
