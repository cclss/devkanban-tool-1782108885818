/**
 * Guards the self-hosted PDF worker against version drift.
 *
 * `lib/pdf.ts` serves the worker from `public/pdf.worker.min.mjs` and pdf.js
 * hard-fails if the worker build differs from the API build. This test asserts
 * the committed copy is byte-identical to the worker inside the installed
 * `pdfjs-dist`, so a bump/reinstall without re-running the sync script (which
 * runs on `dev`/`build`) is caught here instead of at signer runtime.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

describe('self-hosted pdf worker', () => {
  // Resolve the installed pdfjs-dist from disk to compare its worker build. This
  // node-only jest test intentionally uses require to read the package manifest
  // synchronously; the rule targets app/runtime code, not a build-time guard.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const pkgJsonPath = require.resolve('pdfjs-dist/package.json');
  const { version } = require('pdfjs-dist/package.json') as { version: string };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const installedWorker = join(dirname(pkgJsonPath), 'build', 'pdf.worker.min.mjs');
  const committedWorker = join(__dirname, '..', '..', 'public', 'pdf.worker.min.mjs');

  it('ships a worker for the installed pdfjs-dist version', () => {
    expect(existsSync(installedWorker)).toBe(true);
    expect(existsSync(committedWorker)).toBe(true);
    // Sanity: pin is a real semver, not an accidental range.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('committed public worker is byte-identical to the installed one', () => {
    const installed = readFileSync(installedWorker);
    const committed = readFileSync(committedWorker);
    // A friendlier failure than a raw buffer diff: surface the version + sizes.
    expect({
      version,
      installedBytes: installed.length,
      committedBytes: committed.length,
      matches: committed.equals(installed),
    }).toEqual({
      version,
      installedBytes: installed.length,
      committedBytes: installed.length,
      matches: true,
    });
  });
});
