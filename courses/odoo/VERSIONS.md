# Odoo 18, 19 and 20: the differences this course relies on

Every line below was read in the source of that version — the Community code inside the official
Docker images the course prepares (`odoo:18.0-20261124`, `odoo:19.0-20261123`, `odoo:20.0-20261123`;
`release.py` says `FINAL` for all three; 20.0 was released on 2026-09-17) — and confirmed by
installing the reference `l10n_ao` / `l10n_ao_hr` of that version in that image with its tests. The
Enterprise rows were read in the owner's Odoo Enterprise 18.0 and 19.0 addons (no Enterprise 20 was
available); no Enterprise code is in this repository.

## Command line and log

| | 18.0 | 19.0 | 20.0 | Where |
|---|---|---|---|---|
| demo data | loaded by default: `--without-demo=all` | not loaded (`--with-demo`; `--without-demo` deprecated) | same as 19 | `odoo/tools/config.py` |
| `--test-tags` | turns tests on | same | same | `odoo/tools/config.py` |
| final test line | `odoo.tests.result: F failed, E error(s) of N tests when loading database '…'` (ERROR on failure, WARNING with 0 tests) | same | same | `odoo/service/server.py` |
| exit code | 1 when a test fails | same | same | `preload_registries` |
| PostgreSQL | ≥ 12 | ≥ 13 (`MIN_PG_VERSION`) | ≥ 16 | `odoo/release.py` |
| official image | `/mnt/extra-addons`, user `odoo` (uid 100) | also reads `PG*` variables | warns `markdown2 is not installed` (the image lacks the package; harmless) | image |

## Manifest

| | 18.0 | 19.0 | 20.0 |
|---|---|---|---|
| `author` missing | silently `''` | WARNING `Missing author key in manifest` | same as 19 |
| `version` | `'1.0'` → `18.0.1.0` | `'1.0'` → `19.0.1.0` | key dropped in native manifests (default `1.0`) |
| `license` missing | WARNING, `LGPL-3` | same | same |
| a `version` of another series | module not installable | same | same |

## ORM, views, security

| | 18.0 | 19.0 | 20.0 |
|---|---|---|---|
| SQL constraints | `_sql_constraints = [...]` | `models.Constraint('UNIQUE(code)', 'msg')`; the old list is ignored with a WARNING | same as 19 |
| list view | `<list>`; `<tree>` fails: *Invalid view type: 'tree'* | same | same |
| `invisible`/`readonly` | Python expressions (`attrs` gone since 17) | same | same |
| groups of actions and users | `groups_id` | `group_ids` (users also `all_group_ids`) | same as 19 |
| access rights | `ir.model.access` (`security/ir.model.access.csv`: `model_id:id`, four 0/1 columns) + `ir.rule` | same | **`ir.access`** (`security/ir.access.csv`: `id,name,model_id,group_id/id,operation,domain`; `model_id` by name; `operation` ⊆ `crud`; no group = restriction); `ir.model.access` does not exist (`KeyError`) |
| model without access lines | WARNING with a suggested line | same | no warning |
| translations in code | `self.env._()` (also `odoo._`) | `self.env._()` | `self.env._()` |
| test helpers | `TransactionCase`, `tagged`, `new_test_user`, `mute_logger` | same | same |

## Accounting localization

| | 18.0 | 19.0 | 20.0 |
|---|---|---|---|
| chart template | `@template('ao')`, `@template('ao', 'res.company')`, `@template('ao', 'account.journal')` + `data/template/<model>-ao.csv` | same | same |
| account codes | `^[A-Za-z0-9.]+$`, padded right with `0` to `code_digits` | same | `^[A-Za-z0-9.-]+$`; inactive parents are not padded |
| account code storage | per company (`code_store`) | same | same |
| hierarchy | `account.group` CSV (`code_prefix_start`) | same | **no `account.group`**: inactive parent accounts and `parent_id` |
| receivable/payable defaults | template data `property_account_*_id` | template data | company `receivable_account_id`, `payable_account_id` |
| product income/expense defaults | template data `property_account_*_categ_id` | company `income_account_id`, `expense_account_id` | company |
| cash journal | created | not created | not created |
| tax CSV | `repartition_line_ids/…` | + `fiscal_position_ids`, `original_tax_ids` | same as 19 |
| repartition lines | positive tax lines = 100%, negative = −100% (if any) | same | same |
| tax group | `tax_payable_account_id`, `tax_receivable_account_id` | same | those fields removed |
| fiscal position mapping | `account.fiscal.position.tax` (`tax_ids/tax_src_id`, `tax_ids/tax_dest_id`) | on the tax: `fiscal_position_ids` + `original_tax_ids`; an unmapped tax stays | same, but an unmapped tax stays **only** where it lists the position (or lists none) |
| VAT check | `check_vat_<cc>` in `base_vat` (dependency) | same | `base_vat` removed; `base` looks up `check_vat_<cc>` |
| `res.country.vat_label` | yes | yes | yes |

## HR

| | 18.0 | 19.0 | 20.0 |
|---|---|---|---|
| contract | `hr.contract` (Community `hr_contract`) | removed: `hr.version`, which `hr.employee` `_inherits` | same as 19 |
| `ssnid` | on `hr.employee` | on `hr.version` | removed |
| `identification_id` | `hr.employee` | `hr.version` | `hr.version` |
| `resource.calendar.leaves` kind | `time_type` | `time_type` | `count_as` |
| time zone of a schedule | `resource.calendar.tz` | `resource.calendar.tz` | removed: `res.company.tz` (and resources) |
| HR configuration menu | `hr.menu_human_resources_configuration` | same | same |

## Enterprise payroll (read only; 20 not available)

| | 18.0 | 19.0 |
|---|---|---|
| salary rule context | `payslip`, `employee`, `contract`, `categories`, `inputs`, `worked_days` | `version` replaces `contract`; adds `property_inputs` |
| default rules of a new structure | BASIC, GROSS (100), NET (200), deductions… copied from `hr_payroll.default_structure` | same (copied with `copy_data`) |
| paid amount without worked days | the contract wage | the wage only if the structure does not `use_worked_day_lines` |
| dependency | `hr_work_entry_contract_enterprise` | `hr_work_entry_enterprise` |
