import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Base JavaScript recommended rules
  js.configs.recommended,
  
  // TypeScript ESLint recommended configurations
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  
  // TypeScript files configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',
      
      // Production-grade TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn', // Downgrade to warning for MCP usage
      '@typescript-eslint/no-unsafe-call': 'warn', // Downgrade to warning for MCP usage
      '@typescript-eslint/no-unsafe-member-access': 'warn', // Downgrade to warning for MCP usage
      '@typescript-eslint/no-unsafe-return': 'warn', // Downgrade to warning for MCP usage
      '@typescript-eslint/no-unsafe-argument': 'warn', // Downgrade to warning for MCP usage
      '@typescript-eslint/restrict-template-expressions': 'warn', // Downgrade to warning
      '@typescript-eslint/no-base-to-string': 'warn', // Downgrade to warning
      
      // Code quality rules
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',
      'no-param-reassign': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'radix': 'error',
      'yoda': 'error',
      
      // Import/export rules
      'no-duplicate-imports': 'error',
      
      // Stylistic rules that work with Prettier
      'curly': ['error', 'all'],
      'brace-style': 'off', // Handled by Prettier
      'comma-dangle': 'off', // Handled by Prettier
      'indent': 'off', // Handled by Prettier
      'quotes': 'off', // Handled by Prettier
      'semi': 'off', // Handled by Prettier
    },
  },
  
  // Disable conflicting rules with Prettier
  prettierConfig,
  
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '*.js',
      '*.mjs',
      '*.cjs',
      'coverage/**',
      '.nyc_output/**',
      'build/**',
      'out/**',
    ],
  }
);
