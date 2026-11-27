# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
from odoo import api, fields, models
from odoo.exceptions import UserError


class L10nAoExemptionReasonAssign(models.TransientModel):
    _name = 'l10n_ao.exemption.reason.assign'
    _description = "Assign an Angolan Exemption Reason to Taxes"

    reason_id = fields.Many2one('l10n_ao.tax.exemption.reason', string="Exemption Reason", required=True)
    tax_ids = fields.Many2many('account.tax', string="Taxes", default=lambda self: self._default_tax_ids())

    @api.model
    def _default_tax_ids(self):
        # Opened from the Action menu of the tax list: the selected taxes.
        if self.env.context.get('active_model') == 'account.tax':
            return self.env['account.tax'].browse(self.env.context.get('active_ids', []))
        return self.env['account.tax']

    def action_assign(self):
        self.ensure_one()
        if not self.tax_ids:
            raise UserError(self.env._("Select at least one tax."))
        charged = self.tax_ids.filtered(lambda t: t.amount_type != 'percent' or t.amount)
        if charged:
            raise UserError(self.env._(
                "Only 0%% taxes take an exemption reason; these charge tax: %s",
                ", ".join(charged.mapped('name'))))
        self.tax_ids.l10n_ao_exemption_reason_id = self.reason_id
        return {'type': 'ir.actions.act_window_close'}
