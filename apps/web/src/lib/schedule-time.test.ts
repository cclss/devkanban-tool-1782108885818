/**
 * Scheduled-send date/time logic unit tests.
 *
 * Pins the future-only rule the picker rests on:
 *   • empty / whitespace → invalid, no ISO, `empty` reason (prompts selection),
 *   • unparseable / partial values → `invalid`,
 *   • now-or-earlier → `past` (equality with `now` is not "future"),
 *   • a strictly-future instant → valid + a UTC ISO string that round-trips,
 *   • `toDateTimeLocalValue` / `defaultScheduleValue` produce a min-floor and a
 *     guaranteed-valid seed.
 *
 * `now` is always injected, so these run deterministically in the `node`
 * environment with no clock or DOM. Instants are compared via `getTime()` on
 * locally-parsed strings, so assertions hold regardless of the runner's timezone.
 */

import {
  DEFAULT_SCHEDULE_LEAD_MINUTES,
  defaultScheduleValue,
  evaluateSchedule,
  toDateTimeLocalValue,
} from './schedule-time';

const NOW = new Date('2026-08-12T10:00:00');

describe('evaluateSchedule', () => {
  it('treats an empty string as unselected (invalid, empty reason, no ISO)', () => {
    expect(evaluateSchedule('', NOW)).toEqual({ valid: false, iso: null, error: 'empty' });
  });

  it('treats whitespace-only input as empty', () => {
    expect(evaluateSchedule('   ', NOW)).toEqual({ valid: false, iso: null, error: 'empty' });
  });

  it('rejects a value that does not match the datetime-local shape as invalid', () => {
    expect(evaluateSchedule('not-a-date', NOW).error).toBe('invalid');
    // Date-only (missing time) must not slip through as a midnight instant.
    expect(evaluateSchedule('2026-08-12', NOW).error).toBe('invalid');
  });

  it('rejects a well-shaped but impossible instant (bad month) as invalid', () => {
    // Passes the shape guard, but month 13 is not a real calendar month → NaN.
    expect(evaluateSchedule('2026-13-01T10:00', NOW).error).toBe('invalid');
  });

  it('rejects a past instant with no ISO', () => {
    const result = evaluateSchedule('2026-08-12T09:59', NOW);
    expect(result).toEqual({ valid: false, iso: null, error: 'past' });
  });

  it('rejects the current instant (must be strictly future)', () => {
    const result = evaluateSchedule('2026-08-12T10:00', NOW);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('past');
  });

  it('accepts a future instant and returns a UTC ISO string for the same instant', () => {
    const result = evaluateSchedule('2026-08-12T10:01', NOW);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.iso).not.toBeNull();
    // ISO parses back to the exact wall-clock instant the user picked (TZ-safe).
    expect(new Date(result.iso!).getTime()).toBe(new Date('2026-08-12T10:01').getTime());
  });
});

describe('toDateTimeLocalValue', () => {
  it('formats a Date as a zero-padded local YYYY-MM-DDTHH:mm string', () => {
    expect(toDateTimeLocalValue(new Date('2026-01-05T07:03'))).toBe('2026-01-05T07:03');
  });

  it('round-trips: its own output re-parses to the same minute', () => {
    const formatted = toDateTimeLocalValue(NOW);
    expect(new Date(formatted).getTime()).toBe(new Date('2026-08-12T10:00').getTime());
  });
});

describe('defaultScheduleValue', () => {
  it('suggests a future, valid seed one hour ahead by default', () => {
    const seed = defaultScheduleValue(NOW);
    expect(seed).toBe('2026-08-12T11:00');
    expect(evaluateSchedule(seed, NOW).valid).toBe(true);
    expect(DEFAULT_SCHEDULE_LEAD_MINUTES).toBe(60);
  });

  it('floors seconds so the seed lands on a clean minute', () => {
    const seed = defaultScheduleValue(new Date('2026-08-12T10:00:45'), 30);
    expect(seed).toBe('2026-08-12T10:30');
  });

  it('honours a custom lead and stays valid against now', () => {
    const seed = defaultScheduleValue(NOW, 15);
    expect(seed).toBe('2026-08-12T10:15');
    expect(evaluateSchedule(seed, NOW).valid).toBe(true);
  });
});
