/**
 * Jest config for the web app's pure unit tests.
 *
 * Scope is deliberately narrow: the coordinate-transform / geometry logic
 * (`lib/field-geometry.ts`) is plain, DOM-free math, so it runs in the `node`
 * environment with ts-jest — no jsdom, no Next.js compiler in the loop. Component
 * rendering is verified by build/lint and manual desktop QA, not here.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
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
