/**
 * Keep the self-hosted PDF worker in lockstep with the installed `pdfjs-dist`.
 *
 * The signer's PDF viewer sets `GlobalWorkerOptions.workerSrc` to
 * `/pdf.worker.min.mjs` (see `src/lib/pdf.ts`), a static file committed under
 * `public/`. pdf.js refuses to run when the worker build and the API build
 * differ by version, so a stale committed copy silently breaks signer PDF
 * loading after any `pdfjs-dist` bump or reinstall.
 *
 * This script copies the worker straight from the installed package so the
 * committed copy can never drift. It runs before `dev` and `build` (see
 * package.json), so every served/shipped bundle carries a matching worker.
 *
 * Modes:
 *   (default)  copy node_modules worker -> public/ (idempotent; no-op if equal)
 *   --check    assert public/ matches the installed worker; exit 1 on drift.
 *              Used by the jest regression test and any CI gate.
 *
 * Boundary: the served path stays `/pdf.worker.min.mjs` — only the file bytes
 * are synced, never the URL.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, '..');

const WORKER_FILE = 'pdf.worker.min.mjs';
const PUBLIC_WORKER = join(webRoot, 'public', WORKER_FILE);

/** Locate the installed pdfjs build dir and its worker, version-agnostic. */
function resolveInstalledWorker() {
  const pkgJsonPath = require.resolve('pdfjs-dist/package.json');
  const { version } = require('pdfjs-dist/package.json');
  const workerPath = join(dirname(pkgJsonPath), 'build', WORKER_FILE);
  if (!existsSync(workerPath)) {
    throw new Error(
      `pdfjs-dist@${version} has no build/${WORKER_FILE} at ${workerPath}. ` +
        'Reinstall dependencies (pnpm install).',
    );
  }
  return { version, workerPath };
}

function main() {
  const check = process.argv.includes('--check');
  const { version, workerPath } = resolveInstalledWorker();
  const installed = readFileSync(workerPath);
  const committed = existsSync(PUBLIC_WORKER) ? readFileSync(PUBLIC_WORKER) : null;
  const matches = committed !== null && committed.equals(installed);

  if (check) {
    if (!matches) {
      console.error(
        `✗ PDF worker drift: public/${WORKER_FILE} does not match installed ` +
          `pdfjs-dist@${version}. Run \`pnpm --filter @repo/web sync-pdf-worker\` ` +
          '(or `pnpm build`) and commit the result.',
      );
      process.exit(1);
    }
    console.log(`✓ PDF worker matches pdfjs-dist@${version}`);
    return;
  }

  if (matches) {
    console.log(`✓ PDF worker already in sync with pdfjs-dist@${version}`);
    return;
  }
  writeFileSync(PUBLIC_WORKER, installed);
  console.log(`✓ Synced public/${WORKER_FILE} from pdfjs-dist@${version}`);
}

main();
