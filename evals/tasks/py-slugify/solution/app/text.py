import re
import unicodedata


def slugify(title: str, max_len: int = 60) -> str:
    """A URL slug for a post title."""
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len].rstrip("-")
