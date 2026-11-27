from odoo.tests import TransactionCase, tagged

SERIES = '18.0'


@tagged('post_install', '-at_install')
class TestFiscalPositions(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env['res.company'].create({'name': 'Empresa Angolana', 'country_id': cls.env.ref('base.ao').id})
        cls.env.user.company_ids |= cls.company
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=[cls.company.id]))
        cls.company = cls.company.with_env(cls.env)
        cls.env['account.chart.template'].try_loading('ao', company=cls.company, install_demo=False)

    def ref(self, xmlid):
        return self.env['account.chart.template'].with_company(self.company).ref(xmlid)

    def test_the_seven_positions(self):
        FP = self.env['account.fiscal.position']
        fps = FP.search([('company_id', '=', self.company.id)])
        self.assertEqual(len(fps), 7)
        self.assertEqual(self.ref('fp_regime_geral').country_id, self.env.ref('base.ao'))
        self.assertTrue(self.ref('fp_regime_geral').auto_apply)
        self.assertFalse(self.ref('fp_cabinda').auto_apply, "Cabinda is chosen by hand: the law does not tie it to an address")

    def test_automatic_position_by_country(self):
        FP = self.env['account.fiscal.position'].with_company(self.company)
        ao = self.env['res.partner'].create({'name': 'Cliente AO', 'country_id': self.env.ref('base.ao').id})
        pt = self.env['res.partner'].create({'name': 'Cliente PT', 'country_id': self.env.ref('base.pt').id})
        self.assertEqual(FP._get_fiscal_position(ao), self.ref('fp_regime_geral'))
        self.assertEqual(FP._get_fiscal_position(pt), self.ref('fp_estrangeiro'))

    def test_cativacao_maps_14_to_the_cativo_taxes(self):
        sale14 = self.ref('iva_sale_14')
        self.assertEqual(self.ref('fp_cativo_50').map_tax(sale14), self.ref('iva_sale_14_cativo50'))
        self.assertEqual(self.ref('fp_cativo_100').map_tax(sale14), self.ref('iva_sale_14_cativo100'))

    def test_suppliers_outside_the_general_regime_charge_no_iva(self):
        for xmlid in ('iva_purch_14_inv', 'iva_purch_14_fixed', 'iva_purch_14_other', 'iva_purch_7', 'iva_purch_5'):
            self.assertEqual(self.ref('fp_fornecedor_exclusao').map_tax(self.ref(xmlid)), self.ref('iva_purch_0_m04'), xmlid)
            self.assertEqual(self.ref('fp_fornecedor_simplificado').map_tax(self.ref(xmlid)), self.ref('iva_purch_0_m00'), xmlid)

    def test_foreign_and_cabinda(self):
        fp = self.ref('fp_estrangeiro')
        self.assertEqual(fp.map_tax(self.ref('iva_sale_14')), self.ref('iva_sale_0_m30'))
        self.assertEqual(fp.map_tax(self.ref('iva_purch_14_other')), self.ref('iva_purch_14_reverse'))
        self.assertEqual(self.ref('fp_cabinda').map_tax(self.ref('iva_sale_14')), self.ref('iva_sale_1_cab'))

    def test_withholdings_are_not_mapped_away(self):
        ret = self.ref('ret_ii_6_5')
        self.assertEqual(self.ref('fp_fornecedor_exclusao').map_tax(ret), ret)

    def test_taxes_nobody_replaces_stay(self):
        self.assertEqual(self.ref('fp_cativo_50').map_tax(self.ref('iva_sale_5')), self.ref('iva_sale_5'))

    def test_where_the_mapping_lives(self):
        if SERIES == '18.0':
            self.assertEqual(len(self.ref('fp_fornecedor_exclusao').tax_ids), 5, "Odoo 18: account.fiscal.position.tax lines")
        else:
            tax = self.ref('iva_purch_0_m04')
            self.assertEqual(tax.fiscal_position_ids, self.ref('fp_fornecedor_exclusao'))
            self.assertEqual(len(tax.original_tax_ids), 5, "Odoo 19+: the replacement tax lists what it replaces")
            stays = self.ref('iva_sale_14').fiscal_position_ids
            self.assertIn(self.ref('fp_regime_geral'), stays)
            self.assertNotIn(self.ref('fp_cativo_50'), stays, "where a tax is replaced, it does not stay")
