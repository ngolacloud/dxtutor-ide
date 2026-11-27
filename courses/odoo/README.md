# dxtutor course: Odoo (18, 19 and 20)

The official dxtutor course for **Odoo**: write modules the native way by building `l10n_ao`, an
Angolan localization, and `l10n_ao_hr`, its HR companion, for **Odoo 18.0, 19.0 and 20.0** — plus an
Enterprise payroll structure (`l10n_ao_hr_payroll`) for 18 and 19.

- Category `framework`, subject `odoo`, evaluation language `odoo-module` (Python, XML and CSV files
  of modules).
- Every challenge installs the learner's modules in a real Odoo of its series next to a PostgreSQL,
  in dxtutor's private rootless Podman sandbox (`tutor_eval::odoo_check`), runs hidden tests (a small
  `dxt_check` module) and the learner's own, and requires an Odoo log free of warnings.
- Prepared images (pulled by digest by «Prepare course» / `dxt plugin prepare courses/odoo`; grading
  never pulls): `docker.io/library/odoo:18.0-20261124`, `odoo:19.0-20261123`, `odoo:20.0-20261123`,
  `docker.io/library/postgres:17.12`.
- The Enterprise steps run only with `DXTUTOR_ODOO_ENTERPRISE_18` / `DXTUTOR_ODOO_ENTERPRISE_19`
  pointing at your Enterprise addons (mounted read-only); otherwise `dxt plugin test` skips them with
  the reason. dxtutor never downloads or copies Enterprise code.

## Sources and generation

`courses/odoo.toml` is **generated** — never edit it by hand:

```
courses/odoo/src/odoo.src.toml          the course text (units, concepts, drills)
courses/odoo/src/challenges/sNN.toml    one stage: instructions, modules, tests to run
courses/odoo/src/modules/<layer>/sNN/   files a stage adds or changes (layer: common, 18.0, 19.0, 20.0)
courses/odoo/src/modules/<layer>/sNN.starter/   what the learner starts with
courses/odoo/src/modules/<layer>/sNN.grade/     the hidden grader module
```

```sh
python3 scripts/build-odoo-course.py            # regenerate courses/odoo/courses/odoo.toml
python3 scripts/build-odoo-course.py --check    # is it up to date?
python3 scripts/build-odoo-course.py --tree 19.0 s10 /tmp/tree   # one stage's modules, to inspect or install
dxt plugin validate courses/odoo
dxt plugin prepare courses/odoo                 # once: ~7 GB of images
dxt plugin test courses/odoo                    # every stage of every series, starter and solution
```

`VERSIONS.md` lists every difference between 18, 19 and 20 the course relies on.

## The module's design rule

Every legal value is a **record**: taxes, rates, accounts, the withholding threshold, IRT tables,
INSS rates, allowance limits, holiday rules. Values come as seeds (`noupdate="1"`) with their source;
the person responsible edits them in Odoo (Accounting › Configuration › Taxes / Fiscal Positions /
Exemption Reasons (AO); Employees › Configuration › Angola). Python holds rules only. A value the law
does not settle is shipped empty and labelled «to be confirmed», and the computation refuses to run
without it, naming it.

## Legal facts used (from the cited fact sheet of 2026-11-27)

| Topic | Value | Source |
|---|---|---|
| Chart of accounts | PGC classes 1–8 and their accounts | Decreto n.º 82/01, «Quadro e Lista de Contas» (ATF/OCPCA edition) |
| IVA accounts | 34.5.1–34.5.9 and sub-accounts, 34.6, 63.5, 75.3.1.2 | Decreto Presidencial n.º 180/19, arts. 20.º–22.º |
| IVA rates | 14%, 7% (hotelaria e restauração), 5%, 1% (Cabinda) | CIVA art. 19.º (Lei n.º 14/23); Lei n.º 14/25 art. 23.º |
| Cativação | 100% (State, local authorities, oil companies), 50% (BNA, banks, insurers, telecoms) | CIVA art. 21.º |
| Reverse charge | services of non-residents | CIVA arts. 4.º, 29.º |
| Exemption codes and mentions | M10–M24, M30–M38, M80–M86, M90–M93, M00, M02, M04; S01–S03 | Decreto Executivo n.º 683/25, Anexo I, Tabelas 4 and 5 (read on the DR scan) |
| Imposto do Selo | verba 23.3 1%; verbas 2.1 / 2.2 0.1% / 0.4% | CIS (DLP n.º 3/14), DE 683/25 Tabela 3; CIVA art. 74.º |
| II withholding | 6.5% on services; not on services up to Kz 20 000 | Código do II art. 67.º (Lei n.º 26/20) |
| IRT Grupo B withholding | 6.5% | CIRT art. 16.º n.º 2 |
| IAC | 15% (Secção A), 10% (Secção B); the 5% rate revoked from 2026 | Código do IAC art. 27.º; Lei n.º 14/25 art. 41.º |
| Imposto Predial on rents | 15% of gross rent (25% of rent − 40%) | Código do IP arts. 10.º, 16.º, 19.º |
| IVA regimes | exclusão < Kz 25 M; simplificado Kz 25–350 M; geral | CIVA arts. 60.º–69.º-D |
| NIF | nationals: the 14-character BI number; others: AGT sequential number; generic 999999999 | DP n.º 245/21 art. 5.º; Lei n.º 4/09 art. 9.º; DE 683/25 |
| Provinces | 21 (Lei n.º 14/24); ISO 3166-2 codes for 17, Lei n.º 8/25 codes for Icolo e Bengo, Moxico Leste, Cubango, Cuando | Lei n.º 14/24, Lei n.º 8/25, ISO 3166-2:AO |
| INSS | worker 3%, employer 8%, retired worker 8%; base = gross cash pay − subsídio de férias | DP n.º 227/18 arts. 12.º, 13.º |
| IRT Grupo A | the 2026 table (exempt to Kz 150 000; 16%–25%) with its published jump at 150 000 | Lei n.º 14/25 art. 21.º and Anexo I |
| IRT exclusions | food and transport allowances to Kz 30 000 each; abono de família to 5% of base salary | CIRT art. 2.º (Lei n.º 28/20) |
| Holidays | 12 feriados nacionais; ponte Tue→Mon, Thu→Fri; no weekend transfer | Lei n.º 10/11 as amended by Lei n.º 11/18 |

## Left out or shipped empty, because unconfirmed

- **PGC account 27** and the **sub-accounts of 14** — extracted from a two-column PDF; 14 is a leaf,
  27 is absent until checked against a DR scan.
- **Withholding accounts 34.9.1–34.9.4** — no official PGC codes; a documented convention.
- **SAF-T tax codes NOR/INT/RED** — no text maps them to the rates: not in the module.
- **INSS ceiling** — none in DP n.º 227/18, Lei n.º 7/04 not read in full: the parameter exists
  without a value («to be confirmed»; empty = no ceiling).
- **IRT on the subsídios de férias e de Natal** — fully taxable, but how (with the month or
  separately) is not stated: the computation refuses such a month and names the missing rule.
- **The IRT table after 2026** — it sits in the 2026 budget law: valid until 2026-12-31; a 2027
  payroll is refused until a 2027 table is entered.
- **Carnaval and Sexta-Feira Santa** — the law names them without computing them; the rules use the
  custom (Easter − 47, − 2) and say so; the wizard only proposes the dates.
- **The 1h30 ponte compensation** — private-sector enforcement unconfirmed: not modelled.
- **Cabinda's fiscal position** — applied by hand: the law gives the 1% to the Cabinda fiscal space,
  which an address alone does not prove.
- **IS on receipts for the exclusion regime** — an inference only: the tax exists, its use is the
  user's call.
- **Out of scope by design** — accounting reports, SAF-T AO export, invoice signature (RSA–SHA-1 hash
  chain; the RSA-2048 question is open), e-invoicing with AGT, certified numbering: an AGT-certified
  invoicing layer.
- **Odoo 20 Enterprise payroll** — no Enterprise 20 was available to verify it: no 20 step.

This is a course, not legal advice: check the law in force before using the module.
