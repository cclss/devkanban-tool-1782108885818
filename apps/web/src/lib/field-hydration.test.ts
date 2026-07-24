/**
 * Field-value rehydration: turning a server-persisted payload back into the
 * viewer's in-memory {@link FillFieldValue} map so a resumed session shows real
 * signatures/text/dates instead of a "작성됨" placeholder.
 */

import { deserializeFieldValue, seedFieldValues } from './signing';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('deserializeFieldValue', () => {
  it('maps a SIGNATURE value to a data URL', () => {
    expect(deserializeFieldValue('SIGNATURE', PNG)).toEqual({
      type: 'SIGNATURE',
      dataUrl: PNG,
    });
  });

  it('maps a DATE value to date text', () => {
    expect(deserializeFieldValue('DATE', '2026-07-24')).toEqual({
      type: 'DATE',
      text: '2026-07-24',
    });
  });

  it('maps a TEXT value to text (no persisted fontFamily)', () => {
    expect(deserializeFieldValue('TEXT', '홍길동')).toEqual({
      type: 'TEXT',
      text: '홍길동',
    });
  });

  it('returns null for an absent value (null / undefined / empty)', () => {
    expect(deserializeFieldValue('SIGNATURE', null)).toBeNull();
    expect(deserializeFieldValue('TEXT', undefined)).toBeNull();
    expect(deserializeFieldValue('DATE', '')).toBeNull();
  });
});

describe('seedFieldValues', () => {
  const geom = { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05 };

  it('seeds only fields that carry a persisted value, keyed by id', () => {
    const seed = seedFieldValues([
      { id: 'sig', type: 'SIGNATURE', value: PNG, ...geom },
      { id: 'name', type: 'TEXT', value: '홍길동', ...geom },
      { id: 'date', type: 'DATE', value: '2026-07-24', ...geom },
      { id: 'empty', type: 'TEXT', value: null, ...geom },
    ]);

    expect(seed).toEqual({
      sig: { type: 'SIGNATURE', dataUrl: PNG },
      name: { type: 'TEXT', text: '홍길동' },
      date: { type: 'DATE', text: '2026-07-24' },
    });
    // The unfilled field is omitted entirely (viewer keeps its tap affordance).
    expect(seed.empty).toBeUndefined();
  });

  it('returns an empty map when nothing is filled (fresh session)', () => {
    expect(
      seedFieldValues([
        { id: 'a', type: 'SIGNATURE', value: null, ...geom },
        { id: 'b', type: 'TEXT', value: null, ...geom },
      ]),
    ).toEqual({});
  });
});
