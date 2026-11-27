from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

SERIES = '19.0'


@tagged('post_install', '-at_install')
class TestTaxes(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env['res.company'].create({'name': 'Empresa Angolana', 'country_id': cls.env.ref('base.ao').id})
        cls.env.user.company_ids |= cls.company
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=[cls.company.id]))
        cls.company = cls.company.with_env(cls.env)
        cls.env['account.chart.template'].try_loading('ao', company=cls.company, install_demo=False)
        cls.partner = cls.env['res.partner'].create({'name': 'Parceiro'})

    def tax(self, xmlid):
        return self.env['account.chart.template'].with_company(self.company).ref(xmlid)

    def move(self, move_type, tax, amount=1000.0):
        return self.env['account.move'].create({
            'move_type': move_type,
            'partner_id': self.partner.id,
            'invoice_date': '2026-03-02',
            'invoice_line_ids': [Command.create({'name': 'Serviço', 'quantity': 1, 'price_unit': amount, 'tax_ids': [Command.set(tax.ids)]})],
        })

    def tax_lines(self, move):
        return {(l.account_id.code, round(l.balance, 2)) for l in move.line_ids.filtered('tax_line_id')}

    def test_iva_rates_and_company_defaults(self):
        self.assertEqual(self.tax('iva_sale_14').amount, 14)
        self.assertEqual(self.tax('iva_sale_5').amount, 5)
        self.assertEqual(self.tax('iva_sale_1_cab').amount, 1)
        self.assertEqual(self.company.account_sale_tax_id, self.tax('iva_sale_14'))
        self.assertEqual(self.company.account_purchase_tax_id, self.tax('iva_purch_14_other'))

    def test_tax_groups(self):
        group = self.tax('tax_group_iva_14')
        self.assertEqual(group.name, 'IVA 14%')
        if SERIES != '20.0':
            self.assertEqual(group.tax_payable_account_id.code, '34561')
            self.assertEqual(group.tax_receivable_account_id.code, '34571')
        self.assertEqual(self.tax('ret_ii_6_5').tax_group_id, self.tax('tax_group_retencao'))

    def test_sale_iva_goes_to_iva_liquidado(self):
        inv = self.move('out_invoice', self.tax('iva_sale_14'))
        inv.action_post()
        self.assertEqual(inv.amount_tax, 140)
        self.assertEqual(self.tax_lines(inv), {('34531', -140.0)})

    def test_cativo_50_withholds_half_of_the_iva(self):
        inv = self.move('out_invoice', self.tax('iva_sale_14_cativo50'))
        inv.action_post()
        self.assertEqual(inv.amount_total, 1070)
        self.assertEqual(self.tax_lines(inv), {('34531', -140.0), ('34572', 70.0)})

    def test_cativo_100_withholds_all_the_iva(self):
        inv = self.move('out_invoice', self.tax('iva_sale_14_cativo100'))
        inv.action_post()
        self.assertEqual(inv.amount_total, 1000)
        self.assertEqual(self.tax_lines(inv), {('34531', -140.0), ('34572', 140.0)})

    def test_exempt_taxes_carry_their_agt_reason(self):
        tax = self.tax('iva_sale_0_m13')
        self.assertEqual(tax.amount, 0)
        self.assertEqual(tax.l10n_ao_exemption_reason_id.code, 'M13')
        self.assertEqual(self.tax('iva_purch_0_m04').l10n_ao_exemption_reason_id.code, 'M04')

    def test_reverse_charge_nets_to_zero(self):
        bill = self.move('in_invoice', self.tax('iva_purch_14_reverse'))
        bill.action_post()
        self.assertEqual(bill.amount_total, 1000)
        self.assertEqual(self.tax_lines(bill), {('34523', 140.0), ('34534', -140.0)})

    def test_imposto_do_selo_is_a_cost_of_the_issuer(self):
        inv = self.move('out_invoice', self.tax('is_sale_2_2'))
        inv.action_post()
        self.assertEqual(inv.amount_total, 1000)
        self.assertEqual(self.tax_lines(inv), {('34940', -4.0), ('75311', 4.0)})

    def test_ii_withholding_and_its_threshold_come_from_the_tax_record(self):
        ret = self.tax('ret_ii_6_5')
        self.assertEqual(ret.amount, -6.5)
        self.assertEqual(ret.l10n_ao_withholding_threshold, 20000)
        small = self.move('in_invoice', ret, amount=15000)
        with self.assertRaises(UserError):
            small.action_post()
        # Change the value in the record: no code change, a different result.
        ret.l10n_ao_withholding_threshold = 10000
        small.action_post()
        self.assertEqual(self.tax_lines(small), {('34910', -975.0)})
        big = self.move('in_invoice', ret, amount=30000)
        big.action_post()
        self.assertEqual(big.amount_total, 28050)
