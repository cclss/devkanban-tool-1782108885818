/**
 * Contract-detail copy locale gate (grain-5).
 *
 * `contractDetailCopyFor` is the sender detail screen's single source of copy.
 * These pin that the Korean base and the English branch keep full key parity
 * (so no key silently falls back to Korean) and that the two locales actually
 * resolve to different wording where they should.
 */

import { contractDetailCopyFor, CONTRACT_DETAIL_COPY_CATALOGS } from './contract-detail';
import { hasCopyParity } from './copy-locale';

describe('contract-detail copy parity gate', () => {
  it('has full ko/en key parity for every localized surface', () => {
    for (const [surface, { ko, en }] of Object.entries(CONTRACT_DETAIL_COPY_CATALOGS)) {
      expect({ surface, parity: hasCopyParity(ko, en) }).toEqual({ surface, parity: true });
    }
  });

  it('resolves distinct wording per locale', () => {
    const ko = contractDetailCopyFor('ko');
    const en = contractDetailCopyFor('en');
    expect(ko.share.createButton).toBe('링크로 공유');
    expect(en.share.createButton).toBe('Share via link');
    expect(en.notFoundTitle).not.toBe(ko.notFoundTitle);
  });

  it('branches the function-valued summary counts by locale', () => {
    expect(contractDetailCopyFor('ko').summary.recipientCount(3)).toBe('3명');
    expect(contractDetailCopyFor('en').summary.recipientCount(3)).toBe('3 recipients');
    expect(contractDetailCopyFor('ko').summary.pageCount(5)).toBe('5페이지');
    expect(contractDetailCopyFor('en').summary.pageCount(5)).toBe('5 pages');
  });
});
