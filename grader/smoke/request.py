"""O pedido da prova: o primeiro desafio de um só ficheiro do curso de Python, com a solução ou o início.

Uso: python3 request.py <curso.toml> solution|starter
"""

import json
import sys
import tomllib

course, which = sys.argv[1], sys.argv[2]
with open(course, "rb") as f:
    c = tomllib.load(f)
for unit in c["unit"]:
    for step in unit.get("step", []):
        if step.get("kind") == "challenge" and "project" not in step and "gabarito" in step:
            code = step["gabarito"]["solution"] if which == "solution" else step["starter"]
            print(json.dumps({
                "protocol": 1,
                "step": step["id"],
                "language": c["language"],
                "submission": {"kind": "code", "code": code},
            }))
            sys.exit(0)
sys.exit("no one-file challenge with a solution in " + course)
