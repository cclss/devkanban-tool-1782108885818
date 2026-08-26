import { copyKeyDiff, hasCopyParity } from './copy-locale';
import { NEW_CONTRACT_COPY_CATALOGS, newContractCopyFor } from './new-contract-copy';

/**
 * The ko/en key-parity gate for the new-contract start-screen copy. A locale is
 * "fully translated" for this surface when its English catalog has the exact same
 * key structure as the Korean base — a missing English key would otherwise
 * silently fall back to Korean (the very bug this locale refactor exists to close).
 */
describe('new-contract-copy locale parity', () => {
  describe('ko/en key parity for every catalog surface', () => {
    for (const [name, { ko, en }] of Object.entries(NEW_CONTRACT_COPY_CATALOGS)) {
      it(`${name} has identical ko/en keys`, () => {
        // Surfacing the diff makes a failure name the exact missing/extra path.
        expect(copyKeyDiff(ko, en)).toEqual([]);
        expect(hasCopyParity(ko, en)).toBe(true);
      });
    }
  });

  describe('newContractCopyFor', () => {
    it('returns the Korean base for ko and a distinct English catalog for en', () => {
      const ko = newContractCopyFor('ko');
      const en = newContractCopyFor('en');
      expect(ko.chooseTitle).toBe('새 계약을 만들어요');
      expect(en.chooseTitle).toBe('Create a new contract');
      expect(ko.chooseTitle).not.toBe(en.chooseTitle);
    });

    it('localizes the function-valued selectLabel while keeping its signature', () => {
      const ko = newContractCopyFor('ko').selectLabel('표준 근로계약서');
      const en = newContractCopyFor('en').selectLabel('Standard employment');
      expect(ko).toContain('표준 근로계약서');
      expect(en).toContain('Standard employment');
      expect(en).not.toBe(ko);
    });

    it('has non-empty strings for every string leaf in both locales', () => {
      for (const locale of ['ko', 'en'] as const) {
        const copy = newContractCopyFor(locale);
        for (const [key, value] of Object.entries(copy)) {
          if (typeof value === 'string') {
            expect(value.length).toBeGreaterThan(0);
          } else {
            // The only non-string member is the selectLabel accessor.
            expect(typeof value).toBe('function');
            expect(key).toBe('selectLabel');
          }
        }
      }
    });
  });
});
