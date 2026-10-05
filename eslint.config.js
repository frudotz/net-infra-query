import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'tests/output/'] },
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, L: 'readonly' } },
    },
    {
        files: ['js/boot.js'],
        languageOptions: { sourceType: 'script' },
    },
    {
        files: ['sw.js'],
        languageOptions: { sourceType: 'script', globals: globals.serviceworker },
    },
    {
        files: ['tests/**/*.js', '*.config.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    },
    {
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
            'no-restricted-properties': ['error',
                { property: 'innerHTML', message: 'Use textContent / DOM APIs.' },
                { property: 'outerHTML', message: 'Use textContent / DOM APIs.' },
                { object: 'document', property: 'write', message: 'Not allowed.' },
            ],
        },
    },
];
