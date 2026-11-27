# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
"""Public holidays of Angola, pure Python: proposes the dates of a year from the holiday rules.

The rules themselves are records (`l10n_ao_hr.holiday`) the person responsible edits and extends;
this module only knows how to turn a rule into a date:
- a fixed day and month;
- a number of days from Easter Sunday (Carnaval and Sexta-Feira Santa: the law names them but does
  not define the computation; by custom they are Easter - 47 and Easter - 2);
- the *ponte* (Lei n.º 10/11, art. 6.º, as amended by Lei n.º 11/18): a national holiday on a Tuesday
  suspends work on the Monday before it, one on a Thursday on the Friday after it. There is no
  weekend transfer since 2018: a holiday on a Sunday stays on the Sunday.
"""
from datetime import date, timedelta


def easter(year):
    """Easter Sunday in the Gregorian calendar (see the instructions)."""
    raise NotImplementedError


def holiday_date(year, rule):
    raise NotImplementedError


def propose(year, rules):
    """The holidays and pontes of `year` (see the instructions)."""
    raise NotImplementedError
