/**
 * Jest config for the web app's unit + component tests.
 *
 * Two shapes of test share one runner:
 *   • Pure logic (`*.test.ts`) — the coordinate-transform / geometry math and
 *     state reducers are DOM-free, so they default to the `node` environment.
 *   • Component tests (`*.test.tsx`) — render React in jsdom to lock user-facing
 *     interaction contracts (e.g. field-canvas affordances). They opt into jsdom
 *     per file with a `@jest-environment jsdom` docblock, so the fast node default
 *     is untouched for the logic suites.
 *
 * `@repo/ui` ships TypeScript source (`src/index.ts`), which jest would otherwise
 * skip transforming under node_modules; component tests mock it inline, and it is
 * whitelisted from `transformIgnorePatterns` as a safety net.
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
  transformIgnorePatterns: ['/node_modules/(?!(?:\\.pnpm/)?@repo/)'],
};
