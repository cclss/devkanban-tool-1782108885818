/**
 * Dashboard view-mode preference (client-side).
 *
 * The dashboard can show its contracts as a TO-DO **list** or a **kanban** board.
 * Which view the user last chose is remembered in the browser so it survives a
 * reload — exactly like the first-run onboarding flag (`lib/onboarding.ts`):
 * `localStorage` is the source of truth and this module is the single place that
 * knows the key and how it's read/written.
 *
 * This is pure client logic (no React, no UI). Every access is defensive: on the
 * server / non-browser (`typeof window === 'undefined'`) and when `localStorage`
 * itself throws (private-mode quota, disabled storage, security errors) we
 * swallow the failure and fall back to the default view — the reader always gets
 * a valid `ViewMode` rather than a crash, so a storage-less environment simply
 * behaves like "never chose a view" instead of breaking the dashboard.
 *
 * Persistence only *seeds* the initial view on mount; it never resets an
 * in-session choice. The dashboard reads this once after mount and writes back
 * whenever the user switches, so the two views stay a pure conditional render
 * (no data refetch, no lost filter/scroll — see dashboard/page.tsx).
 */

/** The two dashboard views. `list` is the default (TO-DO sorted list). */
export type ViewMode = 'list' | 'kanban';

/** The view shown when nothing has been persisted yet (or storage is unusable). */
export const DEFAULT_VIEW_MODE: ViewMode = 'list';

/**
 * Fixed, versioned key. Not per-user-scoped by design: the preference lives in
 * the signed-in browser. The `v1` prefix leaves room to invalidate the stored
 * value later without colliding with a future scheme.
 */
const STORAGE_KEY = 'dashboard:v1:view-mode';

/** Narrow an arbitrary string to a known `ViewMode` (rejects stale/garbage values). */
function isViewMode(value: string | null): value is ViewMode {
  return value === 'list' || value === 'kanban';
}

/**
 * Resolve `localStorage` if — and only if — it's actually usable. Returns `null`
 * outside the browser and when touching `window.localStorage` throws (some
 * browsers throw on access, not just on read/write). Callers treat `null` as
 * "no persistence available".
 */
function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The persisted view, or {@link DEFAULT_VIEW_MODE} when nothing valid is stored
 * or storage is unavailable. Never throws.
 */
export function readViewMode(): ViewMode {
  const storage = safeStorage();
  if (!storage) return DEFAULT_VIEW_MODE;
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return isViewMode(stored) ? stored : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

/**
 * Persist the chosen view. Idempotent — writing the same value is a no-op change
 * — and never throws (a failed write just leaves the previous value, degrading to
 * the old preference rather than crashing).
 */
export function writeViewMode(mode: ViewMode): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage full / unavailable — best effort, stay silent */
  }
}
