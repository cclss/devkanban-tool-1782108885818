/**
 * ESLint configuration for Next.js apps.
 * Layers next/core-web-vitals on top of the shared base.
 */
module.exports = {
  extends: [require.resolve('./base.js'), 'next/core-web-vitals'],
  rules: {},
};
