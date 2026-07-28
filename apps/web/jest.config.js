/**
 * Jest config for the web app's unit + component tests.
 *
 * Two tiers share one runner:
 *   • Pure logic (`lib/field-geometry.ts`, reducers, save-path filters) is
 *     DOM-free math and runs in the default `node` environment — fast, no jsdom.
 *   • Component behavior (recommended-field rendering, accept/修정/삭제 wiring)
 *     opts a single file into jsdom via a per-file `@jest-environment jsdom`
 *     docblock, so the node tier pays nothing for it.
 *
 * `.ts` and `.tsx` are both compiled by ts-jest with the React JSX transform, so
 * a `.test.tsx` can render components with @testing-library/react while the
 * node-tier `.test.ts` files keep running exactly as before.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // Standalone TS transform; isolatedModules keeps it fast and avoids
        // pulling Next-specific type wiring into the test compile.
        isolatedModules: true,
        tsconfig: { jsx: 'react-jsx', esModuleInterop: true },
      },
    ],
  },
};
