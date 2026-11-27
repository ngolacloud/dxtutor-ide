# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
"""The Angolan payroll arithmetic, pure Python: no Odoo import, no rates.

Every value comes in as data — the IRT table and the parameters valid on the computation date, read
from records the person responsible edits in Odoo — so a new law is a new record, not new code.
A required value that is missing raises `MissingValue` with its name; nothing silently uses 0.

Sources of the rules (not of the values, which live in the records):
- INSS base: the gross cash pay minus the subsídio de férias (Decreto Presidencial n.º 227/18,
  art. 13.º); employee and employer rates (art. 12.º).
- IRT Grupo A: the INSS paid by the employee is deducted first, then the parts that are not subject
  (CIRT art. 2.º as amended by Lei n.º 28/20: food and transport allowances up to a limit, abono de
  família up to a percentage of the base salary), then the table is applied: tax = fixed amount +
  rate x (taxable - excess over) (CIRT art. 7.º and 10.º; the 2026 table is Lei n.º 14/25, Anexo I).
- Amounts are rounded to the cent, half up (a convention: no text read sets the rounding).
"""
from decimal import ROUND_HALF_UP, Decimal


class MissingValue(ValueError):
    """A value the computation needs is not configured."""

    def __init__(self, name):
        super().__init__(name)
        self.name = name


def money(amount):
    return float(Decimal(str(amount)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def _required(params, code):
    value = params.get(code)
    if value is None:
        raise MissingValue(code)
    return value


def irt_grupo_a(taxable, table):
    """IRT on a monthly taxable income (see the instructions)."""
    raise NotImplementedError


def inss_contributions(pay, params):
    """INSS of a month (see the instructions)."""
    raise NotImplementedError


def irt_month(pay, params, table):
    """INSS and IRT of a month (see the instructions)."""
    raise NotImplementedError
