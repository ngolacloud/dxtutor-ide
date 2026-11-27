from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestManifest(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.module = cls.env['ir.module.module'].search([('name', '=', 'l10n_ao')])

    def test_installed(self):
        self.assertEqual(self.module.state, 'installed')

    def test_license_is_lgpl3(self):
        self.assertEqual(self.module.license, 'LGPL-3', "a native localization is LGPL-3")

    def test_category_is_the_localizations_one(self):
        # The path 'Accounting/Localizations/Account Charts' is turned into categories whose
        # external ids follow the path (base already names the middle one "Localization").
        self.assertEqual(
            self.module.category_id,
            self.env.ref('base.module_category_accounting_localizations_account_charts'),
            "category must be 'Accounting/Localizations/Account Charts'",
        )

    def test_countries_is_angola(self):
        self.assertEqual(self.module.country_ids, self.env.ref('base.ao'), "countries must be ['ao']")

    def test_depends_on_account(self):
        self.assertIn('account', self.module.dependencies_id.mapped('name'))

    def test_auto_installs_with_account(self):
        self.assertTrue(self.module.auto_install, "auto_install must be ['account']")

    def test_author_is_set(self):
        self.assertTrue(self.module.author, "the manifest must name its author")

    def test_version_has_the_series_prefix(self):
        series = self.env['ir.module.module'].search([('name', '=', 'base')]).latest_version.split('.')[:2]
        self.assertEqual(self.module.latest_version.split('.')[:2], series,
                         "the version is the series plus the module's own number (e.g. 18.0.1.0)")
