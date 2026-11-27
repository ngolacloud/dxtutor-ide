#!/usr/bin/env python3
"""Generates the Odoo course (courses/odoo/courses/odoo.toml) from its sources (Learn P3c).

The course builds a real `l10n_ao` module step by step, once per Odoo series (18.0, 19.0,
20.0). Writing every step's files by hand in the TOML would repeat the whole module dozens of
times, so the module lives as real files that can be installed and reviewed:

    courses/odoo/src/odoo.src.toml          the course text; each line `#@challenge sNN` is
                                            replaced by that stage's challenge steps
    courses/odoo/src/challenges/sNN.toml    a stage: title, instructions, modules to install…
    courses/odoo/src/modules/<layer>/sNN/   the files that stage adds or changes
    courses/odoo/src/modules/<layer>/sNN.starter/   what the learner starts that stage with
    courses/odoo/src/modules/<layer>/sNN.grade/     the hidden grader module of that stage

`<layer>` is `common` (all series) and then the series itself (`18.0`…), which wins. The tree
of a series at stage N is every stage up to N overlaid in order. For a stage:

- the starter is the tree at the previous stage with the stage's `.starter` overlay on top;
- the solution is every file of the tree at that stage that differs from the starter (and
  those files are the editable ones; everything else is read-only, graded from the course copy);
- the hidden files are the grader module plus a generated `checks.toml` with the [odoo] table;
- a stage may `exclude` path prefixes (the HR stages leave `l10n_ao/` out: they do not need it).

A file whose content is exactly `@delete` in an overlay removes that file from the tree.

    python3 scripts/build-odoo-course.py          # rewrite courses/odoo/courses/odoo.toml
    python3 scripts/build-odoo-course.py --check  # exit 1 if it is out of date
    python3 scripts/build-odoo-course.py --tree 19.0 s08 OUT   # write one stage's tree to OUT

Requires Python 3.11+ (tomllib).
"""
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSE = ROOT / "courses" / "odoo"
SRC = COURSE / "src"
OUT = COURSE / "courses" / "odoo.toml"
SERIES = ["18.0", "19.0", "20.0"]
DELETE = "@delete"


def stages() -> list[str]:
    return sorted(p.stem for p in (SRC / "challenges").glob("s*.toml"))


def read_overlay(layer: str, name: str) -> dict[str, str]:
    base = SRC / "modules" / layer / name
    out: dict[str, str] = {}
    if not base.is_dir():
        return out
    for p in sorted(base.rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts:
            out[p.relative_to(base).as_posix()] = p.read_text(encoding="utf-8")
    return out


def apply(tree: dict[str, str], overlay: dict[str, str]) -> None:
    for k, v in overlay.items():
        if v.strip() == DELETE:
            tree.pop(k, None)
        else:
            tree[k] = v


def stage_versions(stage: str) -> list[str]:
    meta = tomllib.loads((SRC / "challenges" / f"{stage}.toml").read_text(encoding="utf-8"))
    return meta.get("versions", SERIES)


def tree_at(series: str, stage: str) -> dict[str, str]:
    tree: dict[str, str] = {}
    for s in stages():
        if s > stage:
            break
        if series not in stage_versions(s):
            continue  # a stage that does not exist for this series (the Enterprise payroll in 20)
        for layer in ("common", series):
            apply(tree, read_overlay(layer, s))
    return tree


def previous(stage: str) -> str | None:
    all_ = stages()
    i = all_.index(stage)
    return all_[i - 1] if i else None


def stage_files(series: str, stage: str, exclude: tuple[str, ...] = ()):
    prev = previous(stage)
    starter = tree_at(series, prev) if prev else {}
    for layer in ("common", series):
        apply(starter, read_overlay(layer, f"{stage}.starter"))
    final = tree_at(series, stage)
    if exclude:
        starter = {k: v for k, v in starter.items() if not k.startswith(exclude)}
        final = {k: v for k, v in final.items() if not k.startswith(exclude)}
    extra = set(starter) - set(final)
    if extra:
        raise SystemExit(f"{series} {stage}: starter files not in the solution: {sorted(extra)}")
    solution = {k: v for k, v in final.items() if starter.get(k) != v}
    for k in solution:
        if k not in starter:
            raise SystemExit(
                f"{series} {stage}: `{k}` is new in the solution but has no starter stub "
                f"(add it to {stage}.starter)"
            )
    grade: dict[str, str] = {}
    for layer in ("common", series):
        apply(grade, read_overlay(layer, f"{stage}.grade"))
    return starter, solution, grade


def q(text: str) -> str:
    """A TOML multi-line literal string (no escapes), or a basic one when it holds `'''`."""
    if "'''" not in text:
        return "'''\n" + text + "'''"
    esc = text.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
    return '"""\n' + esc + '"""'


def key(k: str) -> str:
    return '"' + k.replace("\\", "\\\\").replace('"', '\\"') + '"'


def sub(text: str, series: str, meta: dict) -> str:
    major = series.split(".")[0]
    vals = {"series": series, "major": major}
    vals.update(meta.get("vars", {}).get(series, {}))
    return re.sub(r"\{(\w+)\}", lambda m: str(vals.get(m.group(1), m.group(0))), text)


def checks_toml(meta: dict, series: str) -> str:
    install = meta["install"]
    lines = ["[odoo]", f'version = "{series}"', "install = [" + ", ".join(f'"{m}"' for m in install) + "]"]
    tags = meta.get("test_tags")
    if tags:
        lines.append("test_tags = [" + ", ".join(f'"{t}"' for t in tags) + "]")
    lines.append(f"min_tests = {meta['min_tests']}")
    if meta.get("enterprise"):
        lines.append("enterprise = true")
        lines.append("enterprise_modules = [" + ", ".join(f'"{m}"' for m in meta["enterprise_modules"]) + "]")
    if meta.get("timeout_secs"):
        lines.append(f"timeout_secs = {meta['timeout_secs']}")
    lines.append("message = " + '"' + meta["message"].replace('"', '\\"') + '"')
    return "\n".join(lines) + "\n"


def challenge(stage: str) -> str:
    meta = tomllib.loads((SRC / "challenges" / f"{stage}.toml").read_text(encoding="utf-8"))
    out = []
    for series in meta.get("versions", SERIES):
        starter, solution, grade = stage_files(series, stage, tuple(meta.get("exclude", [])))
        if not solution:
            raise SystemExit(f"{series} {stage}: the solution changes nothing")
        major = series.split(".")[0]
        sid = f"odoo{major}-{stage}-{meta['id']}"
        title = sub(meta["title"], series, meta) + f" (Odoo {series})"
        readonly = sorted(k for k in starter if k not in solution and k not in meta.get("editable", []))
        main = sub(meta["main"], series, meta)
        if main not in solution:
            raise SystemExit(f"{series} {stage}: main `{main}` is not an editable file")
        out.append("[[unit.step]]")
        out.append('kind = "challenge"')
        out.append(f'id = "{sid}"')
        out.append(f"title = {key(title)}")
        out.append(f"points = {meta.get('points', 40)}")
        out.append(f"difficulty = {meta.get('difficulty', 2)}")
        out.append("intro = " + q(sub(meta["intro"], series, meta).strip() + "\n"))
        instr = meta["instructions"]
        extra = meta.get("notes", {}).get(series)
        if extra:
            instr = instr.rstrip() + "\n\n" + extra.strip() + "\n"
        out.append("instructions = " + q(sub(instr, series, meta).strip() + "\n"))
        out.append("")
        out.append("[unit.step.project]")
        out.append(f"main = {key(main)}")
        if readonly:
            out.append("readonly = [" + ", ".join(key(r) for r in readonly) + "]")
        expl = meta["explanation"]
        extra = meta.get("explanation_notes", {}).get(series)
        if extra:
            expl = expl.rstrip() + "\n\n" + extra.strip() + "\n"
        out.append("explanation = " + q(sub(expl, series, meta).strip() + "\n"))
        out.append("")
        out.append("[unit.step.project.starter]")
        for k in sorted(starter):
            out.append(f"{key(k)} = {q(starter[k])}")
        out.append("")
        out.append("[unit.step.project.tests]")
        out.append(f'"checks.toml" = {q(checks_toml(meta, series))}')
        for k in sorted(grade):
            out.append(f"{key(k)} = {q(grade[k])}")
        out.append("")
        out.append("[unit.step.project.solution]")
        for k in sorted(solution):
            out.append(f"{key(k)} = {q(solution[k])}")
        out.append("")
    return "\n".join(out)


def build() -> str:
    src = (SRC / "odoo.src.toml").read_text(encoding="utf-8")
    head = (
        "# GENERATED by scripts/build-odoo-course.py from courses/odoo/src/ — do not edit by hand.\n"
        "# Edit the sources and run `python3 scripts/build-odoo-course.py`.\n"
    )
    lines = []
    for line in src.splitlines():
        m = re.fullmatch(r"#@challenge (s\d+)", line.strip())
        lines.append(challenge(m.group(1)) if m else line)
    return head + "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) >= 4 and argv[0] == "--tree":
        series, stage, out = argv[1], argv[2], Path(argv[3])
        for k, v in tree_at(series, stage).items():
            p = out / k
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(v, encoding="utf-8")
        _, _, grade = stage_files(series, stage)
        for k, v in grade.items():
            p = out / k
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(v, encoding="utf-8")
        return 0
    text = build()
    tomllib.loads(text)  # the result must be valid TOML
    if argv and argv[0] == "--check":
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT.relative_to(ROOT)} is out of date: run python3 scripts/build-odoo-course.py")
            return 1
        print(f"{OUT.relative_to(ROOT)} is up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(text) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
