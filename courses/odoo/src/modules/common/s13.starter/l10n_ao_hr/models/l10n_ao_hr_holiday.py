# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
from datetime import date

from odoo import api, fields, models
from odoo.exceptions import ValidationError


class L10nAoHrHoliday(models.Model):
    _name = 'l10n_ao_hr.holiday'
    _description = "Angolan Public Holiday Rule"
    _order = 'rule, month, day, easter_offset'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    rule = fields.Selection([('fixed', "Fixed date"), ('easter', "Days from Easter Sunday")], required=True, default='fixed')
    day = fields.Integer()
    month = fields.Integer()
    easter_offset = fields.Integer(help="Days from Easter Sunday (Carnaval: -47, Sexta-Feira Santa: -2).")
    bridge = fields.Boolean(string="Ponte", default=True,
                            help="On a Tuesday, the Monday before is also off; on a Thursday, the Friday after.")
    source = fields.Char(help="The law that creates the holiday.")

    @api.constrains('rule', 'day', 'month')
    def _check_fixed_date(self):
        for holiday in self.filtered(lambda h: h.rule == 'fixed'):
            try:
                date(2024, holiday.month, holiday.day)  # a leap year: 29 February is a valid rule
            except ValueError:
                raise ValidationError(self.env._("%s: day %s of month %s does not exist.", holiday.name, holiday.day, holiday.month)) from None

    def _l10n_ao_rules(self):
        return [{
            'name': h.name, 'rule': h.rule, 'day': h.day, 'month': h.month,
            'easter_offset': h.easter_offset, 'bridge': h.bridge,
        } for h in self]
