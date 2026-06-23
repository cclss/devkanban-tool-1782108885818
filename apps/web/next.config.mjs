/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile shared workspace packages from source.
  transpilePackages: ['@repo/ui', '@repo/db'],
  experimental: {
    // Allow importing files from outside the app dir (monorepo packages).
    externalDir: true,
  },
};

export default nextConfig;
