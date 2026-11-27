from datetime import date, datetime

from odoo.addons.l10n_ao_hr.tools import holidays
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

HOLIDAYS_2026 = {
    date(2026, 1, 1), date(2026, 2, 4), date(2026, 2, 17), date(2026, 3, 8), date(2026, 3, 23),
    date(2026, 4, 3), date(2026, 4, 4), date(2026, 5, 1), date(2026, 9, 17), date(2026, 11, 2),
    date(2026, 11, 11), date(2026, 12, 25),
}
PONTES_2026 = {date(2026, 1, 2), date(2026, 2, 16), date(2026, 9, 18)}


@tagged('post_install', '-at_install')
class TestHolidays(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Rule = cls.env['l10n_ao_hr.holiday']

    def proposal(self, year=2026):
        return holidays.propose(year, self.Rule.search([])._l10n_ao_rules())

    def test_easter(self):
        self.assertEqual(holidays.easter(2025), date(2025, 4, 20))
        self.assertEqual(holidays.easter(2026), date(2026, 4, 5))
        self.assertEqual(holidays.easter(2027), date(2027, 3, 28))

    def test_the_twelve_feriados_are_rules(self):
        self.assertEqual(self.Rule.search_count([]), 12)
        carnaval = self.env.ref('l10n_ao_hr.holiday_carnaval')
        self.assertEqual((carnaval.rule, carnaval.easter_offset), ('easter', -47))
        self.assertEqual(self.env.ref('l10n_ao_hr.holiday_sexta_feira_santa').easter_offset, -2)

    def test_2026_as_in_the_published_calendar(self):
        days = self.proposal()
        self.assertEqual({d for d, _, k in days if k == 'holiday'}, HOLIDAYS_2026)
        self.assertEqual({d for d, _, k in days if k == 'bridge'}, PONTES_2026)
        self.assertNotIn(date(2026, 3, 9), {d for d, _, _ in days}, "no weekend transfer since 2018")
        self.assertEqual([d for d, _, _ in days], sorted(d for d, _, _ in days))

    def test_the_rules_are_data(self):
        self.env.ref('l10n_ao_hr.holiday_finados').active = False
        self.Rule.create({'name': 'Feriado municipal', 'rule': 'fixed', 'day': 10, 'month': 10, 'bridge': False})
        days = {d for d, _, _ in self.proposal()}
        self.assertNotIn(date(2026, 11, 2), days)
        self.assertIn(date(2026, 10, 10), days)
        self.assertNotIn(date(2026, 10, 9), days, "no ponte for a rule without one")

    def test_the_wizard_proposes_then_creates_editable_dates_once(self):
        calendar = self.env['resource.calendar'].create({'name': 'Luanda', 'tz': 'Africa/Luanda'})
        wizard = self.env['l10n_ao_hr.public.holiday.wizard'].create({'year': 2026, 'calendar_id': calendar.id})
        wizard.action_propose()
        self.assertEqual(len(wizard.line_ids), 15)
        wizard.line_ids.filtered(lambda l: l.date == date(2026, 9, 18)).selected = False
        wizard.line_ids.filtered(lambda l: l.date == date(2026, 2, 16)).date = date(2026, 2, 13)
        wizard.action_create()
        Leave = self.env['resource.calendar.leaves']
        leaves = Leave.search([('calendar_id', '=', calendar.id), ('resource_id', '=', False)])
        self.assertEqual(len(leaves), 14)
        new_year = leaves.filtered(lambda l: l.name == 'Dia do Ano Novo')
        self.assertEqual(new_year.date_from, datetime(2025, 12, 31, 23, 0), "midnight in Luanda (UTC+1), stored in UTC")
        self.assertTrue(leaves.filtered(lambda l: l.date_from.date() == date(2026, 2, 12)), "the edited date is kept")
        again = self.env['l10n_ao_hr.public.holiday.wizard'].create({'year': 2026, 'calendar_id': calendar.id})
        again.action_propose()
        again.action_create()
        # The second run creates only what is not there yet: 16 February and 18 September.
        leaves = Leave.search([('calendar_id', '=', calendar.id), ('resource_id', '=', False)])
        self.assertEqual(len(leaves), 16)
        self.assertEqual(len(set(leaves.mapped('date_from'))), 16, "no duplicates")

    def test_only_hr_managers_generate(self):
        officer = new_test_user(self.env, 'ao_hol_officer', groups='base.group_user,hr.group_hr_user')
        with self.assertRaises(AccessError):
            self.env['l10n_ao_hr.public.holiday.wizard'].with_user(officer).create({'year': 2026})
