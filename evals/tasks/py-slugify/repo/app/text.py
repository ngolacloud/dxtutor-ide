import re


def slugify(title: str, max_len: int = 60) -> str:
    """A URL slug for a post title."""
    s = title.lower()
    s = re.sub(r"[^a-z0-9]", "-", s)
    return s[:max_len]
