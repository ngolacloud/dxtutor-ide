# Django: Web Apps the Batteries-Included Way

The official [Django](https://docs.djangoproject.com/en/5.2/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **framework** course,
graded in Python with Django's own test runner. You build a small bookshelf (authors, books with a
reading status, reviews) one layer at a time:

| Unit | Level | What you build |
|---|---|---|
| Views and URLs | Basic | four views and their routes: converters, query strings, escaping, 405 |
| Models and migrations | Basic | the `Book` model's fields, choices, ordering and a unique constraint, and migration `0002` by hand |
| The ORM | Basic | `books/queries.py`: lookups across relations, `Q`, `annotate`, `aggregate`, `select_related`, `update` |
| Templates | Intermediate | the book list (filtered by status, one query) and the book page, extending a base template |
| Forms | Intermediate | `BookForm` (a ModelForm with its own rules) and the create view (Post/Redirect/Get, CSRF) |
| The admin | Intermediate | `ModelAdmin`s with columns, search, filters, an inline and an action |
| Testing Django code | Advanced | your own tests, graded by mutation: they must catch four broken versions of the app |
| A JSON API with plain Django | Advanced | list, create, read, update (PATCH) and delete in JSON, validated by `BookForm` |
| Final project: reviews | Advanced | one feature through every layer: model, migration, form, views, template, admin and API |

9 units, 36 steps: each unit has a concepts text, a concept step, two drills (retype a complete
program, a comment on every line) and a project step — a real Django project with `manage.py`,
where only the files of the task are editable. Hidden tests run with `python manage.py test`
against a fresh SQLite database.

## Dependencies: pinned, hashed, prepared once

Every step runs against **Django 5.2.19** (5.2 is the long-term support release, supported until
April 2028) with **asgiref 3.12.1** and **sqlparse 0.6.1**, declared once in the `[build]` table of
`courses/django.toml`, each with its exact version and the sha256 of its wheel on PyPI.

Grading never uses the network. The packages are installed **once** into a Python environment
(venv) of this course — not into your Python — in an explicit step the learner approves:

- in the app: Learning Track → Django → **Prepare course** (lists the packages and shows the exact
  commands; audited);
- on the command line: `dxt plugin prepare courses/django`.

Preparing runs `python3 -m venv`, then `pip install --require-hashes --only-binary=:all:` from
PyPI and `pip check`. You need Python 3.10 or newer with its `venv` module (`python3-venv` on
Debian and Ubuntu).

## Contribute

Source of truth: `courses/django/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request:

```sh
dxt plugin validate courses/django --strict
dxt plugin prepare courses/django     # once (network)
dxt plugin test courses/django        # every drill runs, every solution passes, every starter fails
```

To move to a newer Django, change the three pinned lines (versions and wheel hashes from
`https://pypi.org/pypi/<name>/<version>/json`), then prepare and test again.
