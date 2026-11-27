# Part of the dxtutor Odoo course (l10n_ao_hr). License: LGPL-3.
{
    'name': 'Angola - Human Resources',
    'category': 'Human Resources/Employees',
    'summary': 'INSS number, public holidays, and versioned IRT tables and payroll parameters for Angola',
    'author': 'dxtutor',
    'countries': ['ao'],
    'depends': ['hr'],
    'data': [
        'security/ir.access.csv',
        'data/l10n_ao_hr_parameter_data.xml',
        'data/l10n_ao_hr_irt_data.xml',
        'data/l10n_ao_hr_holiday_data.xml',
        'views/hr_employee_views.xml',
        'views/l10n_ao_hr_config_views.xml',
        'views/l10n_ao_hr_holiday_views.xml',
    ],
    'license': 'LGPL-3',
}
