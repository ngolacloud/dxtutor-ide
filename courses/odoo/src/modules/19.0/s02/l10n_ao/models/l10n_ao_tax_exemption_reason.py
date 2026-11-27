# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError

# The AGT exemption tables: Decreto Executivo n.º 683/25, de 22 de Agosto, Anexo I, Tabela 4
# (IVA, codes M..) and Tabela 5 (Imposto do Selo, codes S..) — DR I Série n.º 159, pp. 19223-19226.
CODE_PATTERN = re.compile(r'^[MS][0-9]{2}$')
PREFIX = {'iva': 'M', 'is': 'S'}


class L10nAoTaxExemptionReason(models.Model):
    _name = 'l10n_ao.tax.exemption.reason'
    _description = "Angolan Tax Exemption Reason"
    _order = 'code'
    _rec_names_search = ['code', 'name']

    code = fields.Char(required=True, size=3, help="The code of the AGT table (M11, S01…), as written in SAF-T and e-invoices.")
    name = fields.Char(string="Mention", required=True, help="The text printed on the invoice (\"Menção a constar no documento\").")
    description = fields.Text(help="What the exemption covers.")
    tax_type = fields.Selection([('iva', "IVA"), ('is', "Imposto do Selo")], required=True, default='iva')
    active = fields.Boolean(default=True)

    _code_uniq = models.Constraint('UNIQUE(code)', "An exemption reason code must be unique.")

    @api.depends('code', 'name')
    def _compute_display_name(self):
        for reason in self:
            reason.display_name = f"{reason.code} - {reason.name}" if reason.code else reason.name

    @api.constrains('code', 'tax_type')
    def _check_code(self):
        for reason in self:
            if not CODE_PATTERN.match(reason.code or ''):
                raise ValidationError(self.env._(
                    "%s is not an AGT exemption code: a letter and two digits, e.g. M11.", reason.code))
            if reason.code[0] != PREFIX[reason.tax_type]:
                raise ValidationError(self.env._(
                    "%(code)s must start with %(prefix)s for this tax type.",
                    code=reason.code, prefix=PREFIX[reason.tax_type]))
