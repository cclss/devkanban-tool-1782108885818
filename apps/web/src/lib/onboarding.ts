/**
 * First-run onboarding completion flag (client-side).
 *
 * The new-user experience — 2 DEMO contracts + the welcome coach-mark guide —
 * shows until the user finishes onboarding (their first real contract). We record
 * "done" once in the browser so that state survives reloads and never comes back:
 * `localStorage` is the source of truth, this module is the single place that knows
 * the key and how it's read/written.
 *
 * This is pure client logic (no React, no UI). Every access is defensive: on the
 * server / non-browser (`typeof window === 'undefined'`) and when `localStorage`
 * itself throws (private-mode quota, disabled storage, security errors) we swallow
 * the failure and fall back to a boolean — the reader always gets `false` rather
 * than a crash, so a storage-less environment simply behaves like "not yet
 * onboarded" instead of breaking the dashboard.
 */

/**
 * Fixed, versioned key. Not per-user-scoped by design: the flag lives in the
 * signed-in browser and a real contract (grain-3's gate) is the durable signal,
 * so a single stable key is enough. The `v1` prefix leaves room to invalidate the
 * flag later without colliding with a future scheme.
 */
const STORAGE_KEY = 'onboarding:v1:complete';

/** Presence + this exact value means complete; anything else reads as not-complete. */
const FLAG_VALUE = '1';

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

/** Whether the user has completed first-run onboarding. Never throws. */
export function isOnboardingComplete(): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) === FLAG_VALUE;
  } catch {
    return false;
  }
}

/**
 * Mark onboarding as complete. Idempotent — writing the same value repeatedly is a
 * no-op change — and never throws (a failed write just leaves the flag unset,
 * which degrades to showing onboarding again rather than crashing).
 */
export function markOnboardingComplete(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, FLAG_VALUE);
  } catch {
    /* storage full / unavailable — best effort, stay silent */
  }
}
