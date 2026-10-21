import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src/brand/wordmark.generated.ts', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The design tokens are the only place colours may be written.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'Hard-coded colour. Add it to src/tokens.ts and use the CSS variable.',
        },
      ],
    },
  },
  { files: ['src/tokens.ts', 'src/**/*.test.ts'], rules: { 'no-restricted-syntax': 'off' } },
  {
    files: ['scripts/**/*.mjs', 'vite.*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
