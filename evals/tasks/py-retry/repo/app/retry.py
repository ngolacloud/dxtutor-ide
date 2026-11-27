import time


def retry(attempts=3, base_delay=0.1, max_delay=2.0, exceptions=(Exception,), sleep=time.sleep):
    """Retries the decorated function (not implemented yet)."""
    def wrap(fn):
        return fn
    return wrap
