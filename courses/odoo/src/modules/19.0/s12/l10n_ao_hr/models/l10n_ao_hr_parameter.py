# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
from odoo import api, fields, models


class L10nAoHrParameter(models.Model):
    _name = 'l10n_ao_hr.parameter'
    _description = "Angolan Payroll Parameter"
    _order = 'code'

    name = fields.Char(required=True)
    code = fields.Char(required=True, help="The technical name the computation asks for (e.g. inss_employee_rate).")
    description = fields.Text(help="What the value means, its unit, and whether it is confirmed.")
    value_ids = fields.One2many('l10n_ao_hr.parameter.value', 'parameter_id', string="Values")

    _code_uniq = models.Constraint('UNIQUE(code)', "A parameter code must be unique.")

    @api.model
    def _l10n_ao_get(self, code, date):
        """The value of `code` valid on `date` (the latest one starting on or before it), or None."""
        value = self.env['l10n_ao_hr.parameter.value'].search(
            [('parameter_id.code', '=', code), ('date_from', '<=', date)], order='date_from desc', limit=1)
        return value.value if value else None

    @api.model
    def _l10n_ao_get_all(self, date):
        """Every parameter's value on `date` (None when it has none), in one query."""
        result = dict.fromkeys(self.search([]).mapped('code'))
        values = self.env['l10n_ao_hr.parameter.value'].search([('date_from', '<=', date)], order='date_from desc')
        for value in values:
            if result.get(value.parameter_id.code) is None:
                result[value.parameter_id.code] = value.value
        return result


class L10nAoHrParameterValue(models.Model):
    _name = 'l10n_ao_hr.parameter.value'
    _description = "Angolan Payroll Parameter Value"
    _order = 'date_from desc'
    _rec_name = 'date_from'

    parameter_id = fields.Many2one('l10n_ao_hr.parameter', required=True, ondelete='cascade', index=True)
    date_from = fields.Date(string="Valid From", required=True)
    value = fields.Float(required=True, digits=(16, 4))
    source = fields.Char(help="The law or document that sets this value.")

    _date_uniq = models.Constraint('UNIQUE(parameter_id, date_from)', "A parameter has one value per start date.")
