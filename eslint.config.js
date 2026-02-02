import tanstackRouter from '@tanstack/eslint-plugin-router';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/routeTree.gen.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@tanstack/router': tanstackRouter,
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      '@tanstack/router/create-route-property-order': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'react/prop-types': 'off'
    },
  },
];
