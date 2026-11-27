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
        """Fill the lines with the dates proposed by tools.holidays (see the instructions)."""
        raise NotImplementedError

    def action_create(self):
        """Create the public holidays of the selected lines (see the instructions)."""
        raise NotImplementedError


class L10nAoHrPublicHolidayWizardLine(models.TransientModel):
    _name = 'l10n_ao_hr.public.holiday.wizard.line'
    _description = "Proposed Angolan Public Holiday"
    _order = 'date'

    wizard_id = fields.Many2one('l10n_ao_hr.public.holiday.wizard', required=True, ondelete='cascade')
    date = fields.Date(required=True)
    name = fields.Char(required=True)
    kind = fields.Selection([('holiday', "Holiday"), ('bridge', "Ponte")], required=True, default='holiday')
    selected = fields.Boolean(default=True)
