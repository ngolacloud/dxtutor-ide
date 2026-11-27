# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


class AccountTax(models.Model):
    _inherit = 'account.tax'

    l10n_ao_exemption_reason_id = fields.Many2one(
        'l10n_ao.tax.exemption.reason',
        string="Exemption Reason (AO)",
        ondelete='restrict',
        help="Why this tax charges no IVA: the AGT code and the mention printed on the invoice.",
    )
    l10n_ao_withholding_threshold = fields.Float(
        string="Withholding Threshold (AO)",
        digits='Account',
        help="This withholding does not apply to a vendor bill whose untaxed amount, in company currency, "
             "does not exceed this value (Código do Imposto Industrial, art. 67.º, n.º 13, c)). "
             "0 means no threshold.",
    )

    @api.constrains('l10n_ao_exemption_reason_id', 'amount', 'amount_type')
    def _check_l10n_ao_exemption_reason(self):
        for tax in self:
            if tax.l10n_ao_exemption_reason_id and (tax.amount_type != 'percent' or tax.amount):
                raise ValidationError(self.env._(
                    "Only a 0%% tax can carry an exemption reason (tax %s).", tax.name))

    @api.constrains('l10n_ao_withholding_threshold')
    def _check_l10n_ao_withholding_threshold(self):
        for tax in self:
            if tax.l10n_ao_withholding_threshold < 0:
                raise ValidationError(self.env._("A withholding threshold cannot be negative (tax %s).", tax.name))
