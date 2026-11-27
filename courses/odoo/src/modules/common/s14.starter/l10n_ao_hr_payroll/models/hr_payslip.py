# Part of the dxtutor Odoo course (l10n_ao_hr_payroll). License: LGPL-3. Original code; it depends on
# the Odoo Enterprise module hr_payroll, which is not part of the course.
from odoo import models


class HrPayslip(models.Model):
    _inherit = 'hr.payslip'

    def _l10n_ao_compute(self, gross):
        """INSS and IRT of this payslip on `gross`, with the IRT table and the parameters of
        l10n_ao_hr valid on the payslip's end date. A missing value stops the computation with
        its name (raised by l10n_ao_hr), never a silent 0."""
        self.ensure_one()
        return self.env['l10n_ao_hr.irt.table']._l10n_ao_compute_month(self.date_to, base_salary=gross)
