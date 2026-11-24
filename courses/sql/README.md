# SQL: From Zero to Confident

The official SQL course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track, on **SQLite**. It has 34 units and 170 steps, from your first `SELECT` to
joins, subqueries, constraints and schema design, transactions, indexes and query plans,
pagination and upserts, CTEs (including recursive ones), window functions, JSON, dates,
triggers, and real analytics patterns. Notes along the way point out where PostgreSQL and
MySQL differ.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete SQL script line by line, with a comment for every line;
- **challenge**: write a query or a script, judged by hidden tests on several data sets.

| Level | Units |
|---|---|
| Basic | SELECT & expressions, tables & types, filtering, sorting, functions & CASE, aggregates |
| Intermediate | GROUP BY, joins, outer joins, subqueries, set operations, modifying data, constraints, normalization, NULL logic, transactions, indexes, N+1, pagination, views, upserts |
| Advanced | CTEs, recursive CTEs, window ranking, window aggregates, JSON, dates, triggers, query optimization, hierarchies, gaps & islands, pivoting, data cleaning, analytics |

Grading needs only **Python 3** (`python3`): its standard library ships SQLite, so the
`sqlite3` CLI isn't required.

## Hidden tests

Hidden tests are Python `unittest` cases with helpers from a prelude:

```python
SETUP = """CREATE TABLE t(x); INSERT INTO t VALUES (3), (1), (2);"""

class T(unittest.TestCase):
    def test_sorted(self):
        cols, rows = query(SETUP)          # runs the learner's single statement
        self.assertEqual(cols, ["x"])
        self.assertEqual(rows, [(1,), (2,), (3,)])
```

`query(setup)` returns `(columns, rows)` for a single statement. `script(setup)` runs the
whole script and returns the connection. `connect(setup)` opens a fresh database.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install sql           # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/sql/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request, run `dxt plugin validate . --strict` and
`dxt plugin test .`.
