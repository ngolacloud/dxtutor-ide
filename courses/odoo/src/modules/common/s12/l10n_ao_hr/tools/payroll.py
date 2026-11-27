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
    """IRT on a monthly taxable income with `table` = {'exempt_threshold': x, 'brackets': [
    {'lower': a, 'upper': b or None, 'fixed': f, 'rate': r (percent), 'excess': e}, ...]}."""
    threshold = table.get('exempt_threshold')
    if threshold is None:
        raise MissingValue('exempt_threshold')
    if taxable <= threshold:
        return 0.0
    for b in sorted(table.get('brackets', []), key=lambda b: b['lower']):
        if taxable > b['lower'] and (not b['upper'] or taxable <= b['upper']):
            return money(b['fixed'] + b['rate'] / 100.0 * (taxable - b['excess']))
    raise MissingValue('IRT bracket for %s' % money(taxable))


def inss_contributions(pay, params):
    """INSS of a month. `pay`: base_salary, other_cash, food_allowance, transport_allowance,
    family_allowance, holiday_subsidy, christmas_subsidy (amounts) and retired (bool)."""
    gross = sum(pay.get(k, 0.0) for k in (
        'base_salary', 'other_cash', 'food_allowance', 'transport_allowance',
        'family_allowance', 'holiday_subsidy', 'christmas_subsidy'))
    base = gross - pay.get('holiday_subsidy', 0.0)
    ceiling = params.get('inss_ceiling')
    if ceiling:
        base = min(base, ceiling)
    employee_rate = _required(params, 'inss_retired_employee_rate' if pay.get('retired') else 'inss_employee_rate')
    employer_rate = _required(params, 'inss_employer_rate')
    return {
        'gross': money(gross),
        'inss_base': money(base),
        'inss_employee': money(base * employee_rate / 100.0),
        'inss_employer': money(base * employer_rate / 100.0),
    }


def irt_month(pay, params, table):
    """INSS and IRT of a month (see `inss_contributions` for `pay`)."""
    if pay.get('holiday_subsidy') or pay.get('christmas_subsidy'):
        # Both are fully taxable since Lei n.º 28/20, but whether they are taxed with the month or
        # separately is not stated in the texts read: refuse rather than guess.
        raise MissingValue('IRT treatment of the subsídio de férias/Natal (to be confirmed)')
    inss = inss_contributions(pay, params)
    exempt = 0.0
    food = pay.get('food_allowance', 0.0)
    if food:
        exempt += min(food, _required(params, 'irt_food_allowance_limit'))
    transport = pay.get('transport_allowance', 0.0)
    if transport:
        exempt += min(transport, _required(params, 'irt_transport_allowance_limit'))
    family = pay.get('family_allowance', 0.0)
    if family:
        rate = _required(params, 'irt_family_allowance_rate')
        exempt += min(family, pay.get('base_salary', 0.0) * rate / 100.0)
    taxable = money(inss['gross'] - inss['inss_employee'] - exempt)
    return dict(inss, irt_taxable=taxable, irt=irt_grupo_a(taxable, table))
