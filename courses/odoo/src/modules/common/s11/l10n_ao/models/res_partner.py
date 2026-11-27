# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
import re

from odoo import api, models

# NIF — Decreto Presidencial n.º 245/21, de 4 de Outubro, art. 5.º: a national's NIF is the number of
# the Bilhete de Identidade (14 characters, Lei n.º 4/09, art. 9.º); foreigners and companies get a
# sequential number from AGT, whose length is not published, and the e-invoice allows at most 15
# characters (Decreto Executivo n.º 683/25). No check-digit algorithm is published for either, so
# only the format is checked. "999999999" (the generic final consumer) is digits, hence valid.
NIF_BI = re.compile(r'^[0-9A-Z]{14}$')
NIF_AGT = re.compile(r'^[0-9]{1,15}$')


class ResPartner(models.Model):
    _inherit = 'res.partner'

    @api.model
    def check_vat_ao(self, vat):
        nif = re.sub(r'[\s.\-]', '', vat or '').upper()
        return bool(NIF_BI.match(nif) or NIF_AGT.match(nif))
