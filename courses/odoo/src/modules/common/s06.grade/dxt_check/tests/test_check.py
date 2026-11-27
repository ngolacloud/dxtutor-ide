from odoo.tests import TransactionCase, tagged

PROVINCES = {
    'CAB': 'Cabinda', 'ZAI': 'Zaire', 'UIG': 'Uíge', 'BGO': 'Bengo', 'LUA': 'Luanda',
    'IBE': 'Icolo e Bengo', 'CNO': 'Cuanza-Norte', 'CUS': 'Cuanza-Sul', 'MAL': 'Malanje',
    'LNO': 'Lunda-Norte', 'LSU': 'Lunda-Sul', 'MOX': 'Moxico', 'MLE': 'Moxico Leste', 'BIE': 'Bié',
    'HUA': 'Huambo', 'BGU': 'Benguela', 'NAM': 'Namibe', 'HUI': 'Huíla', 'CNN': 'Cunene',
    'CGO': 'Cubango', 'CDO': 'Cuando',
}
IVA_CODES = {f'M{n}' for n in [*range(10, 25), *range(30, 39), *range(80, 87), *range(90, 94)]} | {'M00', 'M02', 'M04'}


@tagged('post_install', '-at_install')
class TestData(TransactionCase):

    def test_the_21_provinces_of_lei_14_24(self):
        states = self.env['res.country.state'].search([('country_id', '=', self.env.ref('base.ao').id)])
        self.assertEqual({s.code: s.name for s in states}, PROVINCES)

    def test_provinces_have_external_ids(self):
        self.assertEqual(self.env.ref('l10n_ao.state_ao_cab').code, 'CAB')
        self.assertEqual(self.env.ref('l10n_ao.state_ao_ibe').name, 'Icolo e Bengo')

    def test_every_code_of_tabela_4_and_5(self):
        reasons = self.env['l10n_ao.tax.exemption.reason'].search([])
        self.assertEqual(set(reasons.filtered(lambda r: r.tax_type == 'iva').mapped('code')), IVA_CODES)
        self.assertEqual(set(reasons.filtered(lambda r: r.tax_type == 'is').mapped('code')), {'S01', 'S02', 'S03'})

    def test_mentions_are_copied_as_published(self):
        ref = self.env.ref
        self.assertEqual(ref('l10n_ao.exemption_reason_m13').name, 'Isento nos termos da alínea d) do n.º 1 do artigo 12.º do CIVA')
        self.assertEqual(ref('l10n_ao.exemption_reason_m18').name, 'Isento nos termos da alínea i) do n.º 1 artigo 12.º do CIVA')
        self.assertEqual(ref('l10n_ao.exemption_reason_m22').name, 'Isento nos termos da alínea m) do artigo 12.º do CIVA')
        self.assertEqual(ref('l10n_ao.exemption_reason_m30').name, 'Isento nos termos da alínea a) do artigo 15.º do CIVA')
        self.assertEqual(ref('l10n_ao.exemption_reason_m80').name, 'Isento nos termos da alínea a) do n.º 1 do artigo 14.º')
        self.assertEqual(ref('l10n_ao.exemption_reason_m04').name, 'IVA – Regime de Exclusão')
        self.assertEqual(ref('l10n_ao.exemption_reason_s02').name, 'Isento nos termos do Artigo 28.º do CBF')

    def test_reasons_are_a_seed_that_updates_keep(self):
        data = self.env['ir.model.data'].search([('module', '=', 'l10n_ao'), ('name', '=', 'exemption_reason_m11')])
        self.assertTrue(data.noupdate, "load the AGT table with <odoo noupdate=\"1\">: edits made in the UI survive updates")
