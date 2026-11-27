# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
from datetime import datetime, time
from zoneinfo import ZoneInfo

from odoo import api, fields, models
from odoo.exceptions import UserError

from ..tools import holidays


class L10nAoHrPublicHolidayWizard(models.TransientModel):
    _name = 'l10n_ao_hr.public.holiday.wizard'
    _description = "Generate Angolan Public Holidays"

    year = fields.Integer(required=True, default=lambda self: fields.Date.context_today(self).year)
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company)
    calendar_id = fields.Many2one(
        'resource.calendar', string="Working Schedule",
        domain="[('company_id', 'in', [company_id, False])]",
        help="Empty: the holidays apply to every working schedule of the company.")
    line_ids = fields.One2many('l10n_ao_hr.public.holiday.wizard.line', 'wizard_id', string="Proposed Dates")

    def _l10n_ao_tz(self):
        # Odoo 20 moved the time zone from the working schedule to the company (res.company.tz).
        return self.company_id.tz or self.env.user.tz or 'UTC'

    def action_propose(self):
        self.ensure_one()
        rules = self.env['l10n_ao_hr.holiday'].search([])._l10n_ao_rules()
        self.line_ids = [(5, 0, 0)] + [
            (0, 0, {'date': day, 'name': name, 'kind': kind, 'selected': True})
            for day, name, kind in holidays.propose(self.year, rules)
        ]
        return {
            'type': 'ir.actions.act_window', 'res_model': self._name, 'res_id': self.id,
            'view_mode': 'form', 'target': 'new', 'name': self.env._("Generate Public Holidays"),
        }

    def action_create(self):
        self.ensure_one()
        lines = self.line_ids.filtered('selected')
        if not lines:
            raise UserError(self.env._("Propose the dates first, and keep at least one selected."))
        tz = ZoneInfo(self._l10n_ao_tz())
        utc = ZoneInfo('UTC')
        Leave = self.env['resource.calendar.leaves']
        existing = set(Leave.search([
            ('company_id', '=', self.company_id.id), ('calendar_id', '=', self.calendar_id.id),
            ('resource_id', '=', False),
        ]).mapped('date_from'))
        vals_list = []
        for line in lines:
            start = datetime.combine(line.date, time.min, tzinfo=tz).astimezone(utc).replace(tzinfo=None)
            end = datetime.combine(line.date, time(23, 59, 59), tzinfo=tz).astimezone(utc).replace(tzinfo=None)
            if start in existing:
                continue
            existing.add(start)
            vals_list.append({
                'name': line.name, 'date_from': start, 'date_to': end,
                'company_id': self.company_id.id, 'calendar_id': self.calendar_id.id, 'resource_id': False,
            })
        Leave.create(vals_list)
        return {'type': 'ir.actions.act_window_close'}


class L10nAoHrPublicHolidayWizardLine(models.TransientModel):
    _name = 'l10n_ao_hr.public.holiday.wizard.line'
    _description = "Proposed Angolan Public Holiday"
    _order = 'date'

    wizard_id = fields.Many2one('l10n_ao_hr.public.holiday.wizard', required=True, ondelete='cascade')
    date = fields.Date(required=True)
    name = fields.Char(required=True)
    kind = fields.Selection([('holiday', "Holiday"), ('bridge', "Ponte")], required=True, default='holiday')
    selected = fields.Boolean(default=True)
