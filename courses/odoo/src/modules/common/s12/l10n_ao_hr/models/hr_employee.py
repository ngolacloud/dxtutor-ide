# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
from odoo import fields, models


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    l10n_ao_inss_number = fields.Char(
        string="INSS Number",
        groups="hr.group_hr_user",
        tracking=True,
        help="The worker's number in the Protecção Social Obrigatória (INSS).",
    )
