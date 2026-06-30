import * as fs from 'fs';
import * as path from 'path';
import { Plan } from '@repo/db';
import { isBrandingEnabled } from './plan';

describe('isBrandingEnabled', () => {
  it('keeps FREE below the branding gate', () => {
    expect(isBrandingEnabled(Plan.FREE)).toBe(false);
  });

  it('enables the Team tier and up (PRO, ENTERPRISE)', () => {
    expect(isBrandingEnabled(Plan.PRO)).toBe(true);
    expect(isBrandingEnabled(Plan.ENTERPRISE)).toBe(true);
  });

  it('treats a missing plan as not enabled', () => {
    expect(isBrandingEnabled(null)).toBe(false);
    expect(isBrandingEnabled(undefined)).toBe(false);
  });

  // The whole point of the helper: the threshold may live in exactly one place
  // so it can never drift between call sites.
  it('defines the branding plan threshold in a single source file', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          files.push(full);
        }
      }
    };
    walk(srcRoot);

    // The branding entitlement is the only rule pairing PRO with ENTERPRISE.
    const owners = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return src.includes('Plan.PRO') && src.includes('Plan.ENTERPRISE');
    });
    expect(owners.map((f) => path.basename(f))).toEqual(['plan.ts']);
  });
});
