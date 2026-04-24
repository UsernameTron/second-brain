'use strict';

const js = require('@eslint/js');
const pluginJest = require('eslint-plugin-jest');
const pluginN = require('eslint-plugin-n');

module.exports = [
  // Base recommended rules for all JS files
  js.configs.recommended,

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      '.claude/worktrees/**',
    ],
  },

  // src/ — Node.js source files
  {
    files: ['src/**/*.js'],
    plugins: {
      n: pluginN,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': 'warn',
      'prefer-const': 'error',
      eqeqeq: 'error',
    },
  },

  // test/ — Jest test files
  {
    files: ['test/**/*.js'],
    plugins: {
      jest: pluginJest,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...pluginJest.environments.globals.globals,
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      ...pluginJest.configs.recommended.rules,
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': 'off',
      'prefer-const': 'error',
      eqeqeq: 'error',
    },
  },
];
