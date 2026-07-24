import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load the monorepo-root `.env` before Next inlines env vars. Next only
// auto-loads `.env` from this app's own dir (`apps/web`), but the documented
// single source of truth is the repo-root `.env` (`cp .env.example .env`). Its
// `NEXT_PUBLIC_API_URL` would otherwise be silently ignored, leaving the browser
// pointed at the built-in `http://localhost:3001` fallback regardless of config.
// We only fill vars that are not already set, so a platform-injected value
// (production) always wins and this never overrides an existing environment.
const rootEnvPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
try {
  for (const rawLine of readFileSync(rootEnvPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {
  // No root `.env` (e.g. env supplied entirely by the platform) — nothing to do.
}

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
