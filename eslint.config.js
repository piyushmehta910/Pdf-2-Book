const js = require('@eslint/js');

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        crypto: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['public/app-data.js', 'public/extract-core.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        self: 'readonly',
        window: 'readonly',
        document: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        URL: 'readonly',
        btoa: 'readonly',
        crypto: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly'
      }
    }
  },
  {
    files: ['public/extract.worker.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        self: 'readonly',
        importScripts: 'readonly',
        OffscreenCanvas: 'readonly',
        ImageData: 'readonly',
        TextDecoder: 'readonly',
        Blob: 'readonly',
        Uint8ClampedArray: 'readonly',
        URL: 'readonly',
        console: 'readonly'
      }
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        indexedDB: 'readonly'
      }
    }
  }
];
