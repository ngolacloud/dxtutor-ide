from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user


@tagged('post_install', '-at_install')
class TestSecurity(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(cls.env, 'ao_internal', groups='base.group_user')
        cls.manager = new_test_user(cls.env, 'ao_manager', groups='base.group_user,account.group_account_manager')
        cls.portal = new_test_user(cls.env, 'ao_portal', groups='base.group_portal')
        cls.reason = cls.env['l10n_ao.tax.exemption.reason'].create({
            'code': 'M21', 'name': 'Isento nos termos da alínea l) do n.º 1 do artigo 12.º do CIVA',
        })

    def test_internal_users_read(self):
        self.assertEqual(self.reason.with_user(self.user).read(['code'])[0]['code'], 'M21')

    def test_internal_users_cannot_change(self):
        Reason = self.env['l10n_ao.tax.exemption.reason'].with_user(self.user)
        with self.assertRaises(AccessError):
            self.reason.with_user(self.user).write({'name': 'changed'})
        with self.assertRaises(AccessError):
            Reason.create({'code': 'M22', 'name': 'x'})
        with self.assertRaises(AccessError):
            self.reason.with_user(self.user).unlink()

    def test_account_managers_manage(self):
        Reason = self.env['l10n_ao.tax.exemption.reason'].with_user(self.manager)
        new = Reason.create({'code': 'M23', 'name': 'Isento nos termos da alínea n) do artigo 12.º do CIVA'})
        new.write({'description': 'Transporte de doentes'})
        new.unlink()

    def test_portal_users_have_no_access(self):
        with self.assertRaises(AccessError):
            self.reason.with_user(self.portal).read(['code'])

    def test_no_access_for_administrators_only(self):
        # The provisional administrators-only line of unit 2 is gone.
        access = self.env['ir.model.data'].search([('module', '=', 'l10n_ao'), ('name', '=', 'access_l10n_ao_tax_exemption_reason_system')])
        self.assertFalse(access, "remove the provisional base.group_system line")
