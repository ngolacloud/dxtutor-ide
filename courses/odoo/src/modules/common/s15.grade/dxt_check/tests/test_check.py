import inspect

from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestLearnerTests(TransactionCase):

    def test_the_module_ships_its_own_tests(self):
        from odoo.addons.l10n_ao.tests import test_l10n_ao
        source = inspect.getsource(test_l10n_ao)
        self.assertIn('check_vat_ao', source, "test the NIF check")
        self.assertIn('l10n_ao_exemption_reason_id', source, "test the exemption reason constraint")
        self.assertIn('res.country.state', source, "test the provinces")
        self.assertIn("'post_install'", source)
        self.assertIn("'-at_install'", source)

    def test_at_least_three_test_methods(self):
        from odoo.addons.l10n_ao.tests import test_l10n_ao
        methods = [name for _, cls in inspect.getmembers(test_l10n_ao, inspect.isclass)
                   if issubclass(cls, TransactionCase) and cls.__module__ == test_l10n_ao.__name__
                   for name in dir(cls) if name.startswith('test')]
        self.assertGreaterEqual(len(methods), 3)
