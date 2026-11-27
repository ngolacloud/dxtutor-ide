PY ?= python3
SOURCES := $(shell find app tests -name '*.py')

.PHONY: check lint test clean

check: lint test

lint:
	$(PY) -m py_compile $(SOURCES)

test:
	$(PY) -m unittest discover -s tests

clean:
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
