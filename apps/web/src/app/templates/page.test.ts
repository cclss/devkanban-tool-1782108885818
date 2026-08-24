/**
 * Regression pins for `/templates`' empty-state decision and CTA destination.
 *
 * The design spec is explicit: the empty state is judged by *count alone* — a
 * brand-new sender and a veteran who deleted their last template must see the
 * identical screen, with no "have they ever saved one before" signal involved.
 * `resolveTemplatesView` is the single place that decision is made; these tests
 * pin it directly rather than through a rendered component, per the grain's scope
 * (no RTL/jsdom rendering here — that's the boundary this file stays inside of).
 *
 * `NEW_CONTRACT_ROUTE` is the empty-state CTA's destination (and the per-card
 * "이 템플릿으로 시작" action's base route) — the send-wizard entry chooser. Pinning
 * its literal value guards against silent drift of where that CTA sends a user.
 */

import { NEW_CONTRACT_ROUTE, removeTemplateOptimistically, resolveTemplatesView } from './page';
import type { TemplateSummary } from '@/lib/templates';

function template(over: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: 'tpl-1',
    name: '표준 근로계약서 템플릿',
    pageCount: 2,
    fieldCount: 3,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    ...over,
  };
}

describe('resolveTemplatesView', () => {
  it('is "empty" for a count of zero, regardless of new-user vs. deleted-everything history', () => {
    // The function has no way to distinguish these two callers — and per spec, must not.
    expect(resolveTemplatesView([], null)).toBe('empty');
  });

  it('is "loading" while templates have not resolved yet', () => {
    expect(resolveTemplatesView(null, null)).toBe('loading');
  });

  it('is "error" when the initial load failed and nothing is loaded', () => {
    expect(resolveTemplatesView(null, '문제가 생겼어요.')).toBe('error');
  });

  it('is "list" once one or more templates are present', () => {
    expect(resolveTemplatesView([template()], null)).toBe('list');
  });

  it('stays "list" on a background-refresh error once a list has already loaded', () => {
    // An error surfaces via the dismissible action banner in this case, not by
    // replacing an already-rendered list.
    expect(resolveTemplatesView([template()], '문제가 생겼어요.')).toBe('list');
  });
});

describe('NEW_CONTRACT_ROUTE', () => {
  it('points the empty-state CTA at the send-wizard entry chooser', () => {
    expect(NEW_CONTRACT_ROUTE).toBe('/contracts/new');
  });
});

describe('removeTemplateOptimistically (delete regression guard)', () => {
  // `handleDelete` calls this synchronously right after the delete is confirmed
  // — before `deleteTemplate(...)` is awaited, let alone resolved. These tests
  // pin that the deleted item is gone from the returned list immediately,
  // regardless of whether the server has responded yet.
  const survivor = template({ id: 'tpl-keep', name: '유지되는 템플릿' });
  const doomed = template({ id: 'tpl-delete', name: '삭제될 템플릿' });

  it('excludes the confirmed-deleted template from the very next render, before the delete promise settles', () => {
    const beforeServerResponds = removeTemplateOptimistically([survivor, doomed], doomed);
    expect(beforeServerResponds).toEqual([survivor]);
    expect(beforeServerResponds?.some((t) => t.id === doomed.id)).toBe(false);
  });

  it('leaves other templates and their order untouched', () => {
    const another = template({ id: 'tpl-other', name: '다른 템플릿' });
    expect(removeTemplateOptimistically([survivor, doomed, another], doomed)).toEqual([
      survivor,
      another,
    ]);
  });

  it('is a no-op (identity) when the list has not loaded yet', () => {
    expect(removeTemplateOptimistically(null, doomed)).toBeNull();
  });
});
