# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
from odoo import models
from odoo.exceptions import UserError


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _post(self, soft=True):
        self._l10n_ao_check_withholding_thresholds()
        return super()._post(soft=soft)

    def _l10n_ao_check_withholding_thresholds(self):
        """Refuse a withholding tax on a vendor bill at or below the threshold set on the tax.

        The threshold is data (the tax's `l10n_ao_withholding_threshold`), edited in the UI; nothing
        here knows its value.
        """
        for move in self.filtered(lambda m: m.is_purchase_document(include_receipts=True)):
            amount = abs(move.amount_untaxed_signed)
            for tax in move.invoice_line_ids.tax_ids.filtered('l10n_ao_withholding_threshold'):
                if move.company_currency_id.compare_amounts(amount, tax.l10n_ao_withholding_threshold) <= 0:
                    raise UserError(self.env._(
                        "%(tax)s does not apply to %(move)s: its untaxed amount (%(amount)s) does not exceed the "
                        "tax's withholding threshold (%(threshold)s). The threshold is set on the tax "
                        "(Accounting > Configuration > Taxes).",
                        tax=tax.name, move=move.display_name, amount=amount,
                        threshold=tax.l10n_ao_withholding_threshold,
                    ))
