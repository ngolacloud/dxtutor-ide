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
    """Easter Sunday in the Gregorian calendar (the anonymous algorithm of Meeus, Jones and Butcher)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def holiday_date(year, rule):
    if rule['rule'] == 'easter':
        return easter(year) + timedelta(days=rule['easter_offset'])
    return date(year, rule['month'], rule['day'])


def propose(year, rules):
    """The holidays and pontes of `year`: a sorted list of (date, name, kind), kind being
    'holiday' or 'bridge'. `rules`: dicts with name, rule ('fixed' or 'easter'), day, month,
    easter_offset and bridge (whether the holiday gets a ponte)."""
    holidays = [(holiday_date(year, r), r['name'], r.get('bridge')) for r in rules]
    taken = {d for d, _, _ in holidays}
    out = [(d, name, 'holiday') for d, name, _ in holidays]
    for d, name, bridge in holidays:
        if not bridge:
            continue
        weekday = d.weekday()  # Monday is 0
        ponte = d - timedelta(days=1) if weekday == 1 else d + timedelta(days=1) if weekday == 3 else None
        if ponte and ponte not in taken:
            taken.add(ponte)
            out.append((ponte, "Ponte – %s" % name, 'bridge'))
    return sorted(out)
