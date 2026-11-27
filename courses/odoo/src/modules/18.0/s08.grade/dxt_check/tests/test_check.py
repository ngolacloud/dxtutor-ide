from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestChart(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ao = cls.env.ref('base.ao')
        cls.company = cls.env['res.company'].create({'name': 'Empresa Angolana', 'country_id': cls.ao.id})
        cls.env.user.company_ids |= cls.company
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=[cls.company.id]))
        cls.company = cls.company.with_env(cls.env)  # account codes are per company since Odoo 18
        cls.env['account.chart.template'].try_loading('ao', company=cls.company, install_demo=False)

    def account(self, code):
        Account = self.env['account.account'].with_company(self.company)
        return Account.search([*Account._check_company_domain(self.company), ('code', '=', code)])

    def test_angola_maps_to_the_ao_template(self):
        self.assertEqual(self.env['account.chart.template']._guess_chart_template(self.ao), 'ao')
        self.assertEqual(self.company.chart_template, 'ao')
        self.assertEqual(self.company.currency_id, self.env.ref('base.AOA'))

    def test_codes_are_the_pgc_codes_padded_to_five_digits(self):
        self.assertEqual(self.account('51000').name, 'Capital')
        self.assertEqual(self.account('31121').account_type, 'asset_receivable')
        self.assertEqual(self.account('32121').account_type, 'liability_payable')
        self.assertEqual(self.account('88000').account_type, 'equity_unaffected')
        self.assertEqual(self.account('81000').account_type, 'equity')

    def test_the_iva_accounts_of_dp_180_19(self):
        Account = self.env['account.account'].with_company(self.company)
        iva = Account.search([*Account._check_company_domain(self.company), ('code', '=like', '345%')])
        self.assertEqual(len(iva), 26, "34.5.1 to 34.5.9: 26 accounts")
        self.assertEqual(self.account('34531').name, 'IVA liquidado – Operações gerais')
        self.assertEqual(self.account('34531').account_type, 'liability_current')
        self.assertEqual(self.account('34523').account_type, 'asset_current')
        self.assertEqual(self.account('34590').name, 'IVA liquidações oficiosas')

    def test_receivable_and_payable_defaults(self):
        partner = self.env['res.partner'].create({'name': 'Cliente'}).with_company(self.company)
        self.assertEqual(partner.property_account_receivable_id.code, '31121')
        self.assertEqual(partner.property_account_payable_id.code, '32121')

    def test_liquidity_journals_use_the_pgc_bank_and_cash_accounts(self):
        Journal = self.env['account.journal'].with_company(self.company)
        bank = Journal.search([('company_id', '=', self.company.id), ('type', '=', 'bank')], limit=1)
        cash = Journal.search([('company_id', '=', self.company.id), ('type', '=', 'cash')], limit=1)
        self.assertEqual(bank.default_account_id.code, '43110')
        self.assertEqual(cash.default_account_id.code, '45110')

    def test_company_accounts(self):
        self.assertEqual(self.company.income_currency_exchange_account_id.code, '66200')
        self.assertEqual(self.company.expense_currency_exchange_account_id.code, '76200')
        self.assertEqual(self.company.account_journal_early_pay_discount_gain_account_id.code, '66300')
        self.assertEqual(self.company.account_journal_early_pay_discount_loss_account_id.code, '76300')

    def test_unconfirmed_pgc_codes_are_left_out(self):
        self.assertFalse(self.account('27000'), "account 27 is left out until its name is checked against the DR")
        self.assertTrue(self.account('14000'), "14 Imobilizações em curso is there, without its sub-accounts")

    def test_hierarchy_by_account_groups(self):
        Group = self.env['account.group'].with_company(self.company)
        groups = Group.search([('company_id', '=', self.company.id)])
        by_prefix = {g.code_prefix_start: g.name for g in groups}
        self.assertEqual(by_prefix.get('3'), 'Terceiros')
        self.assertEqual(by_prefix.get('345'), 'IVA')
        self.assertEqual(self.account('34531').group_id.code_prefix_start, '3453')

    def test_product_category_defaults(self):
        categ = self.env.ref('product.product_category_all').with_company(self.company)
        self.assertEqual(categ.property_account_expense_categ_id.code, '21200')
        self.assertEqual(categ.property_account_income_categ_id.code, '61310')
