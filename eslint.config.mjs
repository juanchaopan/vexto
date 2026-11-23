import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Relative module paths must name the file with its extension: the Cloud Run image runs the
// TypeScript in src/ with Node directly, and Node resolves only exact file names. Next.js, Vitest,
// tsc and dependency-cruiser read the same paths, so one form works everywhere.
const relativeWithoutExtension = String.raw`/^\.{1,2}\/(?!.*\.(ts|tsx|mts|js|mjs|cjs|css|json)$)/`;
const relativeImportMessage =
  'Name the file of a relative import with its extension, such as ./health-status.ts.';

// eslint-config-next/typescript applies the typescript-eslint recommended rules; the
// typescript-eslint version is pinned in package.json.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      'no-restricted-syntax': [
        'error',
        ...[
          'ImportDeclaration',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'ImportExpression',
        ]
          .map((node) => `${node}[source.value=${relativeWithoutExtension}]`)
          .map((selector) => ({ selector, message: relativeImportMessage })),
      ],
    },
  },
  {
    // Size and nesting limits keep application code readable; tests may be longer and flatter.
    files: ['src/**/*.{ts,tsx,mts}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', 100],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
