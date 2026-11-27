from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestNif(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ao = cls.env.ref('base.ao')
        cls.Partner = cls.env['res.partner']

    def test_angola_labels_its_tax_number_nif(self):
        self.assertEqual(self.ao.vat_label, 'NIF')

    def test_check_vat_ao_checks_the_published_formats_only(self):
        check = self.Partner.check_vat_ao
        for good in ('004567890LA042', '004567890la042', '5417012345', '999999999', '004 567 890 LA 042'):
            self.assertTrue(check(good), good)
        for bad in ('', 'ABC', '004567890LA04', '004567890LA0421', '1234567890123456', '0045-67890-LA04X!'):
            self.assertFalse(check(bad), bad)

    def test_partners_with_an_invalid_nif_are_refused(self):
        self.assertTrue(self.Partner.create({'name': 'Pessoa', 'country_id': self.ao.id, 'vat': '004567890LA042'}))
        self.assertTrue(self.Partner.create({'name': 'Consumidor final', 'country_id': self.ao.id, 'vat': '999999999'}))
        with self.assertRaises(ValidationError):
            self.Partner.create({'name': 'Errado', 'country_id': self.ao.id, 'vat': 'AB12'})

    def test_dependency(self):
        module = self.env['ir.module.module'].search([('name', '=', 'l10n_ao')])
        deps = set(module.dependencies_id.mapped('name'))
        if '18.0' == '20.0':
            self.assertNotIn('base_vat', deps, "Odoo 20 has no base_vat: the check is in base")
        else:
            self.assertIn('base_vat', deps, "in Odoo 18.0 check_vat_<country> is base_vat's mechanism")
