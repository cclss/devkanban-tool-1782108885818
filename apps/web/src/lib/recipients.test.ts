import {
  autoAssignFields,
  isValidEmail,
  moveIndexMap,
  moveRecipient,
  normalizeEmail,
  recipientLabel,
  recipientMessagesFor,
  recipientsComplete,
  remapFieldRecipients,
  removeIndexMap,
  validateRecipients,
  RECIPIENT_COPY_CATALOGS,
} from './recipients';
import { hasCopyParity } from './copy-locale';
import type { RecipientDraft, SignFieldDraft } from '@/components/wizard/wizard-context';

const KO = recipientMessagesFor('ko');
const EN = recipientMessagesFor('en');

function r(id: string, email: string, name = ''): RecipientDraft {
  return { id, email, name };
}

function f(id: string, recipientIndex?: number): SignFieldDraft {
  return { id, type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05, recipientIndex };
}

describe('email validation', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('  user.name@example.co.kr ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });

  it('normalizes for duplicate comparison', () => {
    expect(normalizeEmail('  USER@Example.COM ')).toBe('user@example.com');
  });
});

describe('validateRecipients', () => {
  it('flags empty, malformed, and duplicate emails (Korean)', () => {
    const errors = validateRecipients(
      [r('1', ''), r('2', 'bad'), r('3', 'dup@x.com'), r('4', 'DUP@x.com')],
      'ko',
    );
    expect(errors['1']?.email).toBe(KO.emailRequired);
    expect(errors['2']?.email).toBe(KO.emailInvalid);
    expect(errors['3']).toBeUndefined(); // first occurrence stays clean
    expect(errors['4']?.email).toBe(KO.emailDuplicate);
  });

  it('flags the same faults with English wording under the en locale', () => {
    const errors = validateRecipients(
      [r('1', ''), r('2', 'bad'), r('3', 'dup@x.com'), r('4', 'DUP@x.com')],
      'en',
    );
    expect(errors['1']?.email).toBe(EN.emailRequired);
    expect(errors['2']?.email).toBe(EN.emailInvalid);
    expect(errors['4']?.email).toBe(EN.emailDuplicate);
    // The English message must actually differ from the Korean one (no silent fallback).
    expect(EN.emailRequired).not.toBe(KO.emailRequired);
  });

  it('treats a fully valid distinct list as complete (locale-independent)', () => {
    const list = [r('1', 'a@x.com'), r('2', 'b@x.com')];
    expect(validateRecipients(list, 'ko')).toEqual({});
    expect(recipientsComplete(list)).toBe(true);
  });

  it('is incomplete when empty', () => {
    expect(recipientsComplete([])).toBe(false);
  });
});

describe('recipientLabel', () => {
  it('shows a user-typed name verbatim in either locale', () => {
    expect(recipientLabel(r('1', 'a@x.com', '홍길동'), 0, 'ko')).toBe('홍길동');
    expect(recipientLabel(r('1', 'a@x.com', '홍길동'), 0, 'en')).toBe('홍길동');
  });

  it('falls back to an order-based label in the resolved locale', () => {
    expect(recipientLabel(r('1', ''), 2, 'ko')).toBe('받는 분 3');
    expect(recipientLabel(r('1', ''), 2, 'en')).toBe('Recipient 3');
  });
});

describe('recipient copy parity gate', () => {
  it('has full ko/en key parity for every localized surface', () => {
    for (const [surface, { ko, en }] of Object.entries(RECIPIENT_COPY_CATALOGS)) {
      expect({ surface, parity: hasCopyParity(ko, en) }).toEqual({ surface, parity: true });
    }
  });
});

describe('moveRecipient + moveIndexMap stay in lockstep', () => {
  it('reorders the array', () => {
    const list = [r('1', 'a@x.com'), r('2', 'b@x.com'), r('3', 'c@x.com')];
    expect(moveRecipient(list, 0, 2).map((x) => x.id)).toEqual(['2', '3', '1']);
  });

  it('remaps field indices the same way the array moves', () => {
    // recipients [A,B,C]; move A (0) to end → [B,C,A]
    const map = moveIndexMap(3, 0, 2);
    // A was index 0, now 2; B 1→0; C 2→1
    expect(map.get(0)).toBe(2);
    expect(map.get(1)).toBe(0);
    expect(map.get(2)).toBe(1);

    const fields = [f('fa', 0), f('fb', 1), f('fc', 2)];
    const next = remapFieldRecipients(fields, map);
    expect(next.find((x) => x.id === 'fa')!.recipientIndex).toBe(2);
    expect(next.find((x) => x.id === 'fb')!.recipientIndex).toBe(0);
    expect(next.find((x) => x.id === 'fc')!.recipientIndex).toBe(1);
  });
});

describe('removeIndexMap', () => {
  it('unassigns the removed signer and shifts the rest down', () => {
    const map = removeIndexMap(3, 1); // remove middle
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBeNull();
    expect(map.get(2)).toBe(1);

    const fields = [f('fa', 0), f('fb', 1), f('fc', 2)];
    const next = remapFieldRecipients(fields, map);
    expect(next.find((x) => x.id === 'fa')!.recipientIndex).toBe(0);
    expect(next.find((x) => x.id === 'fb')!.recipientIndex).toBeUndefined();
    expect(next.find((x) => x.id === 'fc')!.recipientIndex).toBe(1);
  });
});

describe('autoAssignFields', () => {
  it('homes unassigned / out-of-range fields to the first recipient', () => {
    const fields = [f('fa'), f('fb', 5), f('fc', 1)];
    const next = autoAssignFields(fields, 2);
    expect(next.find((x) => x.id === 'fa')!.recipientIndex).toBe(0);
    expect(next.find((x) => x.id === 'fb')!.recipientIndex).toBe(0);
    expect(next.find((x) => x.id === 'fc')!.recipientIndex).toBe(1); // already valid
  });

  it('clears all assignments when there are no recipients', () => {
    const next = autoAssignFields([f('fa', 0)], 0);
    expect(next[0]?.recipientIndex).toBeUndefined();
  });

  it('returns the same reference when nothing changes (stable identity)', () => {
    const fields = [f('fa', 0), f('fb', 1)];
    expect(autoAssignFields(fields, 2)).toBe(fields);
  });
});
