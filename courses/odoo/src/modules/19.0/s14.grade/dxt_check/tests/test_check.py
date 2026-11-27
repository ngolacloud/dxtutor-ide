from datetime import date

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestAngolanPayslip(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.user.group_ids |= cls.env.ref('hr_payroll.group_hr_payroll_manager')
        cls.struct = cls.env.ref('l10n_ao_hr_payroll.structure_ao_monthly')
        cls.struct.use_worked_day_lines = False  # pay the wage: this test has no work entries
        cls.stype = cls.env.ref('l10n_ao_hr_payroll.structure_type_employee_ao')
        cls.employee = cls.env['hr.employee'].create({
            'name': 'Trabalhador', 'date_version': date(2026, 1, 1), 'contract_date_start': date(2026, 1, 1),
            'wage': 300000, 'structure_type_id': cls.stype.id,
        })
        cls.extra = {}

    def payslip(self, month=3, year=2026):
        slip = self.env['hr.payslip'].create(dict(self.extra, **{
            'name': 'Recibo', 'employee_id': self.employee.id, 'struct_id': self.struct.id,
            'date_from': date(year, month, 1), 'date_to': date(year, month, 28),
        }))
        slip.compute_sheet()
        return slip

    def lines(self, slip):
        return {line.code: line.total for line in slip.line_ids}

    def test_the_structure_and_its_type(self):
        self.assertEqual(self.struct.country_id, self.env.ref('base.ao'))
        self.assertEqual(self.stype.default_struct_id, self.struct)
        codes = self.struct.rule_ids.mapped('code')
        for code in ('BASIC', 'GROSS', 'NET', 'AO_INSS', 'AO_IRT', 'AO_INSS_COMP'):
            self.assertIn(code, codes)

    def test_a_payslip_takes_inss_and_irt_from_l10n_ao_hr(self):
        lines = self.lines(self.payslip())
        self.assertEqual(lines['GROSS'], 300000)
        self.assertEqual(lines['AO_INSS'], -9000)
        self.assertEqual(lines['AO_IRT'], -47630, "31 250 + 18% x (291 000 - 200 000)")
        self.assertEqual(lines['AO_INSS_COMP'], 24000)
        self.assertEqual(lines['NET'], 300000 - 9000 - 47630)

    def test_changing_a_parameter_changes_the_payslip(self):
        self.env.ref('l10n_ao_hr.param_inss_employer_rate_v2026').value = 9.0
        self.assertEqual(self.lines(self.payslip())['AO_INSS_COMP'], 27000)

    def test_a_payslip_without_an_irt_table_is_refused(self):
        with self.assertRaisesRegex(UserError, 'IRT table'):
            self.payslip(month=1, year=2027)
