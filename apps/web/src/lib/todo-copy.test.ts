import { hasCopyParity, copyKeyDiff } from './copy-locale';
import {
  TODO_COPY_CATALOGS,
  nextActionCopy,
  pendingSignerLabel,
  urgencyLabel,
} from './todo-copy';
import type { NextAction, Urgency } from './documents';

/**
 * The ko/en key-parity gate for the TO-DO copy surface. A locale is "fully
 * translated" for this surface when its English catalog has the exact same key
 * structure as the Korean base — a missing English key would otherwise silently
 * fall back to Korean (the very bug this locale refactor exists to close).
 */
describe('todo-copy locale parity', () => {
  describe('ko/en key parity for every catalog surface', () => {
    for (const [name, { ko, en }] of Object.entries(TODO_COPY_CATALOGS)) {
      it(`${name} has identical ko/en keys`, () => {
        // Surfacing the diff makes a failure name the exact missing/extra path.
        expect(copyKeyDiff(ko, en)).toEqual([]);
        expect(hasCopyParity(ko, en)).toBe(true);
      });
    }
  });

  describe('urgencyLabel', () => {
    const withLabel: Exclude<Urgency, 'NORMAL'>[] = ['OVERDUE', 'DUE_SOON'];

    it('returns a non-empty label in both locales for every labelled urgency', () => {
      for (const urgency of withLabel) {
        expect(urgencyLabel(urgency, 'ko')).not.toBe('');
        expect(urgencyLabel(urgency, 'en')).not.toBe('');
      }
    });

    it('localizes the label (ko and en differ)', () => {
      expect(urgencyLabel('OVERDUE', 'ko')).not.toBe(urgencyLabel('OVERDUE', 'en'));
    });

    it('renders no label for NORMAL in either locale', () => {
      expect(urgencyLabel('NORMAL', 'ko')).toBe('');
      expect(urgencyLabel('NORMAL', 'en')).toBe('');
    });
  });

  describe('nextActionCopy', () => {
    const actions: NextAction[] = ['SEND_DRAFT', 'AWAITING_SIGN', 'DOWNLOAD'];

    it('resolves a labelled copy in both locales, with a locale-invariant kind', () => {
      for (const action of actions) {
        const ko = nextActionCopy(action, 'ko');
        const en = nextActionCopy(action, 'en');
        expect(ko?.label).toBeTruthy();
        expect(en?.label).toBeTruthy();
        // `kind` drives styling, not wording — it must stay identical across locales.
        expect(ko?.kind).toBe(en?.kind);
      }
    });

    it('returns null (no manufactured CTA) when there is no next action', () => {
      expect(nextActionCopy(null, 'ko')).toBeNull();
      expect(nextActionCopy(null, 'en')).toBeNull();
    });
  });

  describe('pendingSignerLabel', () => {
    it('omits the line at 0 in both locales', () => {
      expect(pendingSignerLabel(0, 'ko')).toBeNull();
      expect(pendingSignerLabel(0, 'en')).toBeNull();
    });

    it('produces a localized, count-bearing line for a positive count', () => {
      const ko = pendingSignerLabel(3, 'ko');
      const en = pendingSignerLabel(3, 'en');
      expect(ko).toContain('3');
      expect(en).toContain('3');
      expect(ko).not.toBe(en);
    });
  });
});
