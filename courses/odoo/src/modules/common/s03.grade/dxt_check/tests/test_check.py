from lxml import etree

from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestViews(TransactionCase):

    def _arch(self, xmlid):
        view = self.env.ref(xmlid)
        self.assertEqual(view.model, 'l10n_ao.tax.exemption.reason')
        return etree.fromstring(view.arch)

    def test_list_view(self):
        arch = self._arch('l10n_ao.l10n_ao_tax_exemption_reason_view_list')
        self.assertEqual(arch.tag, 'list', "since Odoo 18 the list view root is <list> (<tree> is refused)")
        self.assertEqual([f.get('name') for f in arch.iter('field')], ['code', 'name', 'tax_type'])

    def test_form_view(self):
        arch = self._arch('l10n_ao.l10n_ao_tax_exemption_reason_view_form')
        self.assertEqual(arch.tag, 'form')
        names = {f.get('name') for f in arch.iter('field')}
        self.assertTrue({'code', 'name', 'tax_type', 'description', 'active'} <= names)
        self.assertTrue(arch.find('sheet') is not None, "the form has a <sheet>")

    def test_search_view(self):
        arch = self._arch('l10n_ao.l10n_ao_tax_exemption_reason_view_search')
        self.assertEqual(arch.tag, 'search')
        filters = {f.get('name'): f for f in arch.iter('filter')}
        self.assertIn('iva', filters)
        self.assertIn('inactive', filters)
        self.assertIn('group_by', filters.get('group_tax_type', etree.Element('x')).get('context', ''))

    def test_action_and_menu(self):
        action = self.env.ref('l10n_ao.action_l10n_ao_tax_exemption_reason')
        self.assertEqual(action.res_model, 'l10n_ao.tax.exemption.reason')
        self.assertEqual(action.view_mode, 'list,form')
        menu = self.env.ref('l10n_ao.menu_l10n_ao_tax_exemption_reason')
        self.assertEqual(menu.parent_id, self.env.ref('account.account_account_menu'))
        self.assertEqual(menu.action, action)

    def test_tax_form_shows_the_reason_only_for_angolan_zero_taxes(self):
        view = self.env.ref('l10n_ao.view_tax_form_inherit_l10n_ao')
        self.assertEqual(view.inherit_id, self.env.ref('account.view_tax_form'))
        arch = etree.fromstring(self.env['account.tax'].get_view(view_type='form')['arch'])
        nodes = arch.xpath("//field[@name='l10n_ao_exemption_reason_id']")
        self.assertEqual(len(nodes), 1, "the reason is in the tax form, once")
        invisible = nodes[0].get('invisible', '')
        for part in ("country_code != 'AO'", "amount != 0"):
            self.assertIn(part, invisible, "use a Python expression in invisible= (attrs= is gone since Odoo 17)")
        group = nodes[0].getprevious()
        self.assertEqual(group.get('name'), 'tax_group_id', "placed right after tax_group_id")
