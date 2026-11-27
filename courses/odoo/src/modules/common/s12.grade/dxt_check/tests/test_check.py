from datetime import date

from lxml import etree

from odoo.addons.l10n_ao_hr.tools import payroll
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

D = date(2026, 3, 31)


@tagged('post_install', '-at_install')
class TestPayrollLayer(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Table = cls.env['l10n_ao_hr.irt.table']
        cls.Param = cls.env['l10n_ao_hr.parameter']
        cls.table = cls.env.ref('l10n_ao_hr.irt_table_2026')

    def irt(self, taxable):
        return payroll.irt_grupo_a(taxable, self.table._l10n_ao_as_dict())

    def test_the_2026_table_as_published(self):
        self.assertEqual(self.table.exempt_threshold, 150000)
        self.assertEqual(len(self.table.bracket_ids), 10)
        last = self.table.bracket_ids.sorted('lower_limit')[-1]
        self.assertEqual((last.lower_limit, last.upper_limit, last.fixed_amount, last.rate), (10000000, 0, 2342250, 25))

    def test_irt_at_the_published_jump_and_in_the_brackets(self):
        self.assertEqual(self.irt(150000), 0.0)
        self.assertEqual(self.irt(150000.01), 12500.0, "the 2.º escalão starts with a fixed Kz 12 500 (as published)")
        self.assertEqual(self.irt(200000), 20500.0)
        self.assertEqual(self.irt(250000), 40250.0)
        self.assertEqual(self.irt(5000000), 1117250.0)
        self.assertEqual(self.irt(10000001), 2342250.25)

    def test_the_seeded_parameters(self):
        get = self.Param._l10n_ao_get
        self.assertEqual(get('inss_employee_rate', D), 3.0)
        self.assertEqual(get('inss_employer_rate', D), 8.0)
        self.assertEqual(get('inss_retired_employee_rate', D), 8.0)
        self.assertEqual(get('irt_food_allowance_limit', D), 30000.0)
        self.assertEqual(get('irt_transport_allowance_limit', D), 30000.0)
        self.assertEqual(get('irt_family_allowance_rate', D), 5.0)
        self.assertIsNone(get('inss_ceiling', D), "the ceiling is unconfirmed: shipped without a value")

    def test_a_month(self):
        r = self.Table._l10n_ao_compute_month(D, base_salary=300000, food_allowance=40000, transport_allowance=20000)
        self.assertEqual(r['gross'], 360000)
        self.assertEqual(r['inss_employee'], 10800)
        self.assertEqual(r['inss_employer'], 28800)
        self.assertEqual(r['irt_taxable'], 299200, "INSS first, then food capped at 30 000 and transport (20 000)")
        self.assertEqual(r['irt'], 49106)

    def test_inss_leaves_out_the_holiday_subsidy_only(self):
        r = self.Table._l10n_ao_compute_inss(D, base_salary=200000, holiday_subsidy=200000, christmas_subsidy=200000)
        self.assertEqual(r['inss_base'], 400000)
        self.assertEqual(r['inss_employee'], 12000)
        retired = self.Table._l10n_ao_compute_inss(D, base_salary=100000, retired=True)
        self.assertEqual(retired['inss_employee'], 8000)

    def test_values_are_data_change_them_and_the_result_changes(self):
        base = self.Table._l10n_ao_compute_month(D, base_salary=300000)
        self.env.ref('l10n_ao_hr.param_inss_employee_rate_v2026').value = 4.0
        changed = self.Table._l10n_ao_compute_month(D, base_salary=300000)
        self.assertEqual(changed['inss_employee'], 12000)
        self.assertNotEqual(changed['irt'], base['irt'])
        self.table.bracket_ids.filtered(lambda b: b.lower_limit == 200000).rate = 20.0
        self.assertEqual(self.Table._l10n_ao_compute_month(D, base_salary=300000)['irt'], 31250 + 0.20 * (288000 - 200000))
        self.env.ref('l10n_ao_hr.param_inss_ceiling').value_ids = [(0, 0, {'date_from': '2026-01-01', 'value': 250000})]
        self.assertEqual(self.Table._l10n_ao_compute_inss(D, base_salary=300000)['inss_base'], 250000)

    def test_a_missing_value_is_refused_with_its_name(self):
        self.env.ref('l10n_ao_hr.param_irt_food_allowance_limit_v2026').unlink()
        with self.assertRaisesRegex(UserError, 'irt_food_allowance_limit'):
            self.Table._l10n_ao_compute_month(D, base_salary=300000, food_allowance=10000)
        with self.assertRaisesRegex(UserError, 'inss_employee_rate'):
            self.Table._l10n_ao_compute_inss(date(2025, 12, 31), base_salary=300000)
        with self.assertRaisesRegex(UserError, 'IRT table'):
            self.Table._l10n_ao_compute_month(date(2027, 1, 31), base_salary=300000)
        with self.assertRaisesRegex(UserError, 'férias/Natal'):
            self.Table._l10n_ao_compute_month(D, base_salary=300000, christmas_subsidy=300000)

    def test_the_layer_is_pure_python(self):
        import inspect
        source = inspect.getsource(payroll)
        self.assertNotIn('import odoo', source)
        self.assertNotIn('from odoo', source)

    def test_employee_inss_number(self):
        self.assertIn('l10n_ao_inss_number', self.env['hr.employee']._fields)
        arch = etree.fromstring(self.env['hr.employee'].get_view(view_type='form')['arch'])
        self.assertTrue(arch.xpath("//field[@name='l10n_ao_inss_number']"))

    def test_hr_officers_read_and_hr_managers_edit(self):
        officer = new_test_user(self.env, 'ao_hr_officer', groups='base.group_user,hr.group_hr_user')
        manager = new_test_user(self.env, 'ao_hr_manager', groups='base.group_user,hr.group_hr_manager')
        self.assertTrue(self.table.with_user(officer).name)
        with self.assertRaises(AccessError):
            self.table.with_user(officer).exempt_threshold = 1
        self.table.with_user(manager).exempt_threshold = 150000
        menu = self.env.ref('l10n_ao_hr.menu_l10n_ao_hr_config')
        self.assertEqual(menu.parent_id, self.env.ref('hr.menu_human_resources_configuration'))
