from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger


@tagged('post_install', '-at_install')
class TestExemptionReason(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Reason = cls.env['l10n_ao.tax.exemption.reason']
        cls.m13 = cls.Reason.create({
            'code': 'M13',
            'name': 'Isento nos termos da alínea d) do n.º 1 do artigo 12.º do CIVA',
            'description': 'Livros, incluindo em formato digital',
        })

    def test_fields(self):
        fields = self.Reason._fields
        for name in ('code', 'name', 'description', 'tax_type', 'active'):
            self.assertIn(name, fields)
        self.assertEqual(fields['code'].type, 'char')
        self.assertTrue(fields['code'].required and fields['name'].required)
        self.assertEqual(fields['tax_type'].type, 'selection')
        self.assertEqual(dict(fields['tax_type'].selection).keys(), {'iva', 'is'})
        self.assertEqual(self.m13.tax_type, 'iva', "tax_type defaults to IVA")
        self.assertTrue(self.m13.active)

    def test_display_name_shows_code_and_mention(self):
        self.assertEqual(self.m13.display_name, 'M13 - Isento nos termos da alínea d) do n.º 1 do artigo 12.º do CIVA')

    def test_search_by_code(self):
        self.assertIn(self.m13.id, [r[0] for r in self.Reason.name_search('M13')])

    def test_code_is_unique(self):
        with mute_logger('odoo.sql_db'), self.assertRaises(Exception):
            with self.cr.savepoint():
                self.Reason.create({'code': 'M13', 'name': 'duplicate'})
                self.env.flush_all()

    def test_code_format(self):
        for bad in ('M1', 'X13', 'm13', '13M'):
            with self.assertRaises(ValidationError, msg=bad):
                self.Reason.create({'code': bad, 'name': 'x'})

    def test_code_letter_matches_tax_type(self):
        with self.assertRaises(ValidationError):
            self.Reason.create({'code': 'S01', 'name': 'x', 'tax_type': 'iva'})
        self.assertTrue(self.Reason.create({'code': 'S01', 'name': 'Isento nos termos do CIS', 'tax_type': 'is'}))

    def test_taxes_carry_a_reason_only_at_zero_percent(self):
        field = self.env['account.tax']._fields.get('l10n_ao_exemption_reason_id')
        self.assertTrue(field, "account.tax needs l10n_ao_exemption_reason_id")
        self.assertEqual(field.comodel_name, 'l10n_ao.tax.exemption.reason')
        zero = self.env['account.tax'].create({'name': 'IVA Isento (test)', 'amount': 0, 'amount_type': 'percent'})
        zero.l10n_ao_exemption_reason_id = self.m13
        with self.assertRaises(ValidationError):
            self.env['account.tax'].create({
                'name': 'IVA 14% (test)', 'amount': 14, 'amount_type': 'percent',
                'l10n_ao_exemption_reason_id': self.m13.id,
            })
