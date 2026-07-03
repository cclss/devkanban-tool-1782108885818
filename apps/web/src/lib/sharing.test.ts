/**
 * Owner-side password confirm/edit helpers (grain-3).
 *
 * Pins the design-spec contract (conventions/share-link-password-admin.md): the
 * three semantic password states (없음 / 확인 가능 / 이전 방식이라 확인 불가) map to
 * the right trigger label, editor hint, and initial field value — the pure logic
 * the dashboard panel binds to. DOM behavior isn't tested here (no jsdom for
 * component tests); this pins the state→copy mapping where it's decided.
 */

import {
  passwordEditorInitialValue,
  passwordStateHint,
  passwordTriggerLabel,
  SHARE_COPY,
  type ShareLinkPasswordView,
} from './sharing';

const NONE: ShareLinkPasswordView = { hasPassword: false, recoverable: false, password: null };
const CONFIRMABLE: ShareLinkPasswordView = {
  hasPassword: true,
  recoverable: true,
  password: 'hunter2',
};
const LEGACY: ShareLinkPasswordView = { hasPassword: true, recoverable: false, password: null };

describe('passwordTriggerLabel', () => {
  it('offers 확인 when a password is set, 설정 when the link is open', () => {
    expect(passwordTriggerLabel(true)).toBe(SHARE_COPY.passwordAdmin.open);
    expect(passwordTriggerLabel(false)).toBe(SHARE_COPY.passwordAdmin.openUnset);
  });
});

describe('passwordStateHint', () => {
  it('maps each semantic state to its hint', () => {
    expect(passwordStateHint(NONE)).toBe(SHARE_COPY.passwordAdmin.hintNone);
    expect(passwordStateHint(CONFIRMABLE)).toBe(SHARE_COPY.passwordAdmin.hintRecoverable);
    expect(passwordStateHint(LEGACY)).toBe(SHARE_COPY.passwordAdmin.hintLegacy);
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
