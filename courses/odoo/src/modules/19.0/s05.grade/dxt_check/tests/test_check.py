from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user


@tagged('post_install', '-at_install')
class TestAssignWizard(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reason = cls.env['l10n_ao.tax.exemption.reason'].create({
            'code': 'M11', 'name': 'Isento nos termos da alínea b) do n.º 1 do artigo 12.º do CIVA',
        })
        Tax = cls.env['account.tax']
        cls.zero_a = Tax.create({'name': 'IVA 0% A (test)', 'amount': 0, 'amount_type': 'percent'})
        cls.zero_b = Tax.create({'name': 'IVA 0% B (test)', 'amount': 0, 'amount_type': 'percent'})
        cls.charged = Tax.create({'name': 'IVA 14% (test)', 'amount': 14, 'amount_type': 'percent'})
        cls.Wizard = cls.env['l10n_ao.exemption.reason.assign']

    def _wizard(self, taxes, env=None):
        ctx = {'active_model': 'account.tax', 'active_ids': taxes.ids}
        return (env or self.env)['l10n_ao.exemption.reason.assign'].with_context(**ctx).create({'reason_id': self.reason.id})

    def test_is_a_transient_model(self):
        self.assertTrue(self.Wizard._transient, "a wizard is a models.TransientModel")

    def test_defaults_to_the_selected_taxes_and_assigns(self):
        wizard = self._wizard(self.zero_a | self.zero_b)
        self.assertEqual(wizard.tax_ids, self.zero_a | self.zero_b)
        result = wizard.action_assign()
        self.assertEqual((self.zero_a | self.zero_b).l10n_ao_exemption_reason_id, self.reason)
        self.assertEqual(result, {'type': 'ir.actions.act_window_close'})

    def test_refuses_taxes_that_charge_tax(self):
        wizard = self._wizard(self.zero_a | self.charged)
        with self.assertRaises(UserError):
            wizard.action_assign()
        self.assertFalse(self.zero_a.l10n_ao_exemption_reason_id, "nothing is assigned when one tax is refused")

    def test_action_opens_in_a_dialog_from_the_tax_list(self):
        action = self.env.ref('l10n_ao.action_l10n_ao_exemption_reason_assign')
        self.assertEqual(action.res_model, 'l10n_ao.exemption.reason.assign')
        self.assertEqual(action.target, 'new')
        self.assertEqual(action.binding_model_id.model, 'account.tax')
        self.assertEqual(action.binding_view_types, 'list')
        groups = action['group_ids']
        self.assertEqual(groups, self.env.ref('account.group_account_manager'))

    def test_form_has_a_footer_with_assign_and_cancel(self):
        from lxml import etree
        arch = etree.fromstring(self.env.ref('l10n_ao.l10n_ao_exemption_reason_assign_view_form').arch)
        buttons = arch.xpath('//footer/button')
        self.assertEqual(buttons[0].get('name'), 'action_assign')
        self.assertEqual(buttons[0].get('type'), 'object')
        self.assertEqual(buttons[1].get('special'), 'cancel')

    def test_only_account_managers_use_it(self):
        user = new_test_user(self.env, 'ao_wiz_user', groups='base.group_user')
        manager = new_test_user(self.env, 'ao_wiz_manager', groups='base.group_user,account.group_account_manager')
        with self.assertRaises(AccessError):
            self._wizard(self.zero_a, env=self.env(user=user))
        self.assertTrue(self._wizard(self.zero_a, env=self.env(user=manager)))
