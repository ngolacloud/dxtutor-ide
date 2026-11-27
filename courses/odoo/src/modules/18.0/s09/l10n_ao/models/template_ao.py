# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
# The chart is the Plano Geral de Contabilidade (Decreto n.º 82/01, de 16 de Novembro), with the
# IVA accounts 34.5.x created by the Decreto Presidencial n.º 180/19, arts. 20.º-22.º. Odoo account
# codes are the PGC codes without dots, padded to `code_digits` (31.1.2.1 -> 31121, 51 -> 51000).
from odoo import models
from odoo.addons.account.models.chart_template import template


class AccountChartTemplate(models.AbstractModel):
    _inherit = 'account.chart.template'

    @template('ao')
    def _get_ao_template_data(self):
        return {
            'code_digits': '5',
            'property_account_receivable_id': 'pgc_31121',
            'property_account_payable_id': 'pgc_32121',
            'property_account_expense_categ_id': 'pgc_212',
            'property_account_income_categ_id': 'pgc_6131',
        }

    @template('ao', 'res.company')
    def _get_ao_res_company(self):
        return {
            self.env.company.id: {
                'account_fiscal_country_id': 'base.ao',
                'bank_account_code_prefix': '4311',
                'cash_account_code_prefix': '4511',
                'transfer_account_code_prefix': '48',
                'income_currency_exchange_account_id': 'pgc_662',
                'expense_currency_exchange_account_id': 'pgc_762',
                'account_journal_early_pay_discount_gain_account_id': 'pgc_663',
                'account_journal_early_pay_discount_loss_account_id': 'pgc_763',
                'account_sale_tax_id': 'iva_sale_14',
                'account_purchase_tax_id': 'iva_purch_14_other',
            },
        }

    @template('ao', 'account.journal')
    def _get_ao_account_journal(self):
        return {
            'bank': {'default_account_id': 'pgc_4311'},
            'cash': {'default_account_id': 'pgc_4511'},
        }
