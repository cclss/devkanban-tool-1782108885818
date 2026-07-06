/**
 * ESLint configuration for NestJS apps.
 * Relaxes a few rules that conflict with Nest's decorator-heavy style.
 */
module.exports = {
  extends: [require.resolve('./base.js')],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};
