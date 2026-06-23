/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile shared workspace packages from source.
  transpilePackages: ['@repo/ui', '@repo/db'],
  experimental: {
    // Allow importing files from outside the app dir (monorepo packages).
    externalDir: true,
  },
  webpack: (config) => {
    // `pdfjs-dist` declares an optional Node-only `canvas` dependency it never
    // needs in the browser (it renders to a DOM <canvas>). Stub it so webpack
    // doesn't try to bundle the native module into the client build.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
