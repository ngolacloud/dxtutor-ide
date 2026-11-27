import functools
import time


def retry(attempts=3, base_delay=0.1, max_delay=2.0, exceptions=(Exception,), sleep=time.sleep):
    """Retries the decorated function on `exceptions`, with exponential backoff."""
    def wrap(fn):
        @functools.wraps(fn)
        def inner(*args, **kwargs):
            for n in range(attempts):
                try:
                    return fn(*args, **kwargs)
                except exceptions:
                    if n == attempts - 1:
                        raise
                    sleep(min(base_delay * 2 ** n, max_delay))
        return inner
    return wrap
