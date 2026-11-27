# Part of the dxtutor Odoo course (l10n_ao_hr_payroll). License: LGPL-3. Original code; it depends on
# the Odoo Enterprise module hr_payroll, which is not part of the course.
{
    'name': 'Angola - Payroll',
    'version': '1.0',
    'category': 'Human Resources/Payroll',
    'summary': 'Angolan salary structure: INSS and IRT computed by l10n_ao_hr from its tables and parameters',
    'author': 'dxtutor',
    'countries': ['ao'],
    'depends': ['hr_payroll', 'l10n_ao_hr'],
    'auto_install': ['hr_payroll'],
    'data': [
        'data/hr_payroll_structure_type_data.xml',
        'data/hr_payroll_structure_data.xml',
        'data/hr_salary_rule_data.xml',
    ],
    'license': 'LGPL-3',
}
