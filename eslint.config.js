import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended'],
  {
    files: ['*.rules'],
    rules: {
      ...firebaseRulesPlugin.configs.recommended.rules
    }
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    }
  }
]
