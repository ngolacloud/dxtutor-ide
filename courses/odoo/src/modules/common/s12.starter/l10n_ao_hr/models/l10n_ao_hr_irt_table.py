# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from ..tools import payroll


class L10nAoHrIrtTable(models.Model):
    _name = 'l10n_ao_hr.irt.table'
    _description = "Angolan IRT Table (Grupo A)"
    _order = 'date_from desc'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    date_from = fields.Date(string="Valid From", required=True)
    date_to = fields.Date(string="Valid Until")
    exempt_threshold = fields.Float(required=True, digits=(16, 2), help="Monthly income up to this amount pays no IRT.")
    bracket_ids = fields.One2many('l10n_ao_hr.irt.bracket', 'table_id', string="Brackets", copy=True)
    source = fields.Char(help="The law that publishes the table.")

    @api.constrains('date_from', 'date_to', 'active')
    def _check_dates(self):
        for table in self:
            if table.date_to and table.date_to < table.date_from:
                raise ValidationError(self.env._("%s ends before it starts.", table.name))
            domain = [('id', '!=', table.id), ('date_from', '<=', table.date_to or '9999-12-31')]
            overlap = self.search(domain).filtered(lambda t: not t.date_to or t.date_to >= table.date_from)
            if table.active and overlap:
                raise ValidationError(self.env._(
                    "%(table)s overlaps %(other)s: only one IRT table can be valid on a date.",
                    table=table.name, other=overlap[0].name))

    @api.model
    def _l10n_ao_table(self, date):
        return self.search([('date_from', '<=', date), '|', ('date_to', '=', False), ('date_to', '>=', date)], limit=1)

    def _l10n_ao_as_dict(self):
        self.ensure_one()
        return {
            'exempt_threshold': self.exempt_threshold,
            'brackets': [{
                'lower': b.lower_limit, 'upper': b.upper_limit or None, 'fixed': b.fixed_amount,
                'rate': b.rate, 'excess': b.excess_over,
            } for b in self.bracket_ids],
        }

    def _l10n_ao_missing(self, error, date):
        return UserError(self.env._(
            "Cannot compute the Angolan payroll on %(date)s: %(name)s is missing. Set it in "
            "Employees > Configuration > Angola (IRT tables and payroll parameters).",
            date=date, name=error.name))

    @api.model
    def _l10n_ao_compute_inss(self, date, **pay):
        params = self.env['l10n_ao_hr.parameter']._l10n_ao_get_all(date)
        try:
            return payroll.inss_contributions(pay, params)
        except payroll.MissingValue as error:
            raise self._l10n_ao_missing(error, date) from None

    @api.model
    def _l10n_ao_compute_month(self, date, **pay):
        """INSS and IRT of a month, with the table and parameters valid on `date`."""
        table = self._l10n_ao_table(date)
        if not table:
            raise self._l10n_ao_missing(payroll.MissingValue(self.env._("an IRT table valid on that date")), date)
        params = self.env['l10n_ao_hr.parameter']._l10n_ao_get_all(date)
        try:
            return payroll.irt_month(pay, params, table._l10n_ao_as_dict())
        except payroll.MissingValue as error:
            raise self._l10n_ao_missing(error, date) from None


class L10nAoHrIrtBracket(models.Model):
    _name = 'l10n_ao_hr.irt.bracket'
    _description = "Angolan IRT Bracket"
    _order = 'table_id, lower_limit'

    table_id = fields.Many2one('l10n_ao_hr.irt.table', required=True, ondelete='cascade', index=True)
    lower_limit = fields.Float(string="Above", required=True, digits=(16, 2))
    upper_limit = fields.Float(string="Up To", digits=(16, 2), help="Empty (0) for the last bracket: no upper limit.")
    fixed_amount = fields.Float(digits=(16, 2))
    rate = fields.Float(string="Rate (%)", required=True, digits=(16, 4))
    excess_over = fields.Float(string="Excess Over", digits=(16, 2))

    @api.constrains('lower_limit', 'upper_limit')
    def _check_limits(self):
        for bracket in self:
            if bracket.upper_limit and bracket.upper_limit <= bracket.lower_limit:
                raise ValidationError(self.env._("An IRT bracket must end above where it starts."))
