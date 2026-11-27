def flatten(obj, prefix=""):
    out = {}
    if isinstance(obj, dict) and obj:
        items = obj.items()
    elif isinstance(obj, list) and obj:
        items = ((str(i), v) for i, v in enumerate(obj))
    else:
        return {prefix: obj} if prefix else obj
    for k, v in items:
        key = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, (dict, list)) and v:
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def _fix(node):
    if isinstance(node, dict) and node and all(k.isdigit() for k in node):
        return [_fix(node[str(i)]) for i in range(len(node))]
    if isinstance(node, dict):
        return {k: _fix(v) for k, v in node.items()}
    return node


def unflatten(flat):
    root = {}
    for key, value in flat.items():
        parts = key.split(".")
        cur = root
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = value
    return _fix(root)
