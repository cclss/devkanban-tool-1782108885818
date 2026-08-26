/**
 * Owner-side password confirm/edit helpers + share-link copy locale gate (grain-3,
 * grain-5).
 *
 * Pins the design-spec contract (conventions/share-link-password-admin.md): the
 * three semantic password states (없음 / 확인 가능 / 이전 방식이라 확인 불가) map to
 * the right trigger label, editor hint, and initial field value — the pure logic
 * the dashboard panel binds to. DOM behavior isn't tested here (no jsdom for
 * component tests); this pins the state→copy mapping where it's decided.
 *
 * Grain-5 adds the locale layer: every copy accessor is now `locale`-branched, so
 * these also assert ko/en key parity (no key can silently fall back to Korean)
 * and that the branched helpers (`passwordTriggerLabel`, `passwordStateHint`,
 * `expiryNote`) actually resolve in the requested language.
 */

import {
  expiryNote,
  passwordEditorInitialValue,
  passwordStateHint,
  passwordTriggerLabel,
  shareCopyFor,
  SHARE_COPY_CATALOGS,
  type ShareLinkPasswordView,
} from './sharing';
import { hasCopyParity } from './copy-locale';

const NONE: ShareLinkPasswordView = { hasPassword: false, recoverable: false, password: null };
const CONFIRMABLE: ShareLinkPasswordView = {
  hasPassword: true,
  recoverable: true,
  password: 'hunter2',
};
const LEGACY: ShareLinkPasswordView = { hasPassword: true, recoverable: false, password: null };

const KO = shareCopyFor('ko');
const EN = shareCopyFor('en');

describe('passwordTriggerLabel', () => {
  it('offers 확인 when a password is set, 설정 when the link is open (Korean)', () => {
    expect(passwordTriggerLabel(true, 'ko')).toBe(KO.passwordAdmin.open);
    expect(passwordTriggerLabel(false, 'ko')).toBe(KO.passwordAdmin.openUnset);
  });

  it('resolves the English labels under the en locale', () => {
    expect(passwordTriggerLabel(true, 'en')).toBe(EN.passwordAdmin.open);
    expect(passwordTriggerLabel(false, 'en')).toBe(EN.passwordAdmin.openUnset);
    expect(EN.passwordAdmin.open).not.toBe(KO.passwordAdmin.open);
  });
});

describe('passwordStateHint', () => {
  it('maps each semantic state to its hint (Korean)', () => {
    expect(passwordStateHint(NONE, 'ko')).toBe(KO.passwordAdmin.hintNone);
    expect(passwordStateHint(CONFIRMABLE, 'ko')).toBe(KO.passwordAdmin.hintRecoverable);
    expect(passwordStateHint(LEGACY, 'ko')).toBe(KO.passwordAdmin.hintLegacy);
  });

  it('maps each semantic state to its English hint under the en locale', () => {
    expect(passwordStateHint(NONE, 'en')).toBe(EN.passwordAdmin.hintNone);
    expect(passwordStateHint(CONFIRMABLE, 'en')).toBe(EN.passwordAdmin.hintRecoverable);
    expect(passwordStateHint(LEGACY, 'en')).toBe(EN.passwordAdmin.hintLegacy);
  });
});

describe('passwordEditorInitialValue', () => {
  it('pre-fills only the confirmable plaintext; empty otherwise', () => {
    expect(passwordEditorInitialValue(CONFIRMABLE)).toBe('hunter2');
    expect(passwordEditorInitialValue(NONE)).toBe('');
    // Legacy: a hash we cannot show — start empty so the owner types a new one.
    expect(passwordEditorInitialValue(LEGACY)).toBe('');
  });
});

describe('expiryNote', () => {
  it('reads the "no expiry" line in each locale', () => {
    expect(expiryNote({ expiresAt: null }, 'ko')).toBe('만료 없이 계속 열 수 있어요.');
    expect(expiryNote({ expiresAt: null }, 'en')).toBe('You can keep opening it with no expiry.');
  });

  it('renders a localized calendar date for a dated link', () => {
    // 2026-07-03 (Asia/Seoul window). ko: "…년 …월 …일", en: "July 3, 2026".
    const ko = expiryNote({ expiresAt: '2026-07-03T00:00:00.000Z' }, 'ko');
    const en = expiryNote({ expiresAt: '2026-07-03T00:00:00.000Z' }, 'en');
    expect(ko).toContain('2026년');
    expect(ko.endsWith('까지 열 수 있어요.')).toBe(true);
    expect(en).toBe('You can open it until July 3, 2026.');
  });
});

describe('share copy parity gate', () => {
  it('has full ko/en key parity for every localized surface', () => {
    for (const [surface, { ko, en }] of Object.entries(SHARE_COPY_CATALOGS)) {
      expect({ surface, parity: hasCopyParity(ko, en) }).toEqual({ surface, parity: true });
    }
  });
});
