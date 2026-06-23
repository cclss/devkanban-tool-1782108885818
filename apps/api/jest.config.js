/**
 * Unit-test config for @repo/api.
 *
 * Colocated `*.spec.ts` files under `src/` run here (the DB-backed `*.e2e-spec.ts`
 * suite has its own config in `test/jest-e2e.json`). Pure services — PDF
 * synthesis, geometry — are tested in isolation with no Nest app or database.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
};
