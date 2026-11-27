# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestL10nAo(TransactionCase):

    def test_nif_formats(self):
        Partner = self.env['res.partner']
        self.assertTrue(Partner.check_vat_ao('004567890LA042'), "a Bilhete de Identidade number")
        self.assertTrue(Partner.check_vat_ao('999999999'), "the generic final consumer")
        self.assertFalse(Partner.check_vat_ao('ABC'))
        self.assertFalse(Partner.check_vat_ao('004567890LA04'), "13 characters")

    def test_exemption_reason_only_on_zero_percent_taxes(self):
        reason = self.env.ref('l10n_ao.exemption_reason_m13')
        with self.assertRaises(ValidationError):
            self.env['account.tax'].create({
                'name': 'IVA 14% (test)', 'amount': 14, 'amount_type': 'percent',
                'l10n_ao_exemption_reason_id': reason.id,
            })

    def test_the_21_provinces(self):
        states = self.env['res.country.state'].search([('country_id', '=', self.env.ref('base.ao').id)])
        self.assertEqual(len(states), 21)
        self.assertIn('CAB', states.mapped('code'))
