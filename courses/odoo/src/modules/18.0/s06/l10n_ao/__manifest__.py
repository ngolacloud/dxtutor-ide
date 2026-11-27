# Part of the dxtutor Odoo course (l10n_ao). License: LGPL-3.
{
    'name': 'Angola - Accounting',
    'version': '1.0',
    'category': 'Accounting/Localizations/Account Charts',
    'summary': 'Angolan chart of accounts (PGC), taxes, provinces and NIF',
    'author': 'dxtutor',
    'countries': ['ao'],
    'depends': ['account'],
    'auto_install': ['account'],
    'data': [
        'security/ir.model.access.csv',
        'data/res.country.state.csv',
        'data/l10n_ao_tax_exemption_reason_data.xml',
        'views/l10n_ao_tax_exemption_reason_views.xml',
        'wizard/l10n_ao_exemption_reason_assign_views.xml',
    ],
    'license': 'LGPL-3',
}
