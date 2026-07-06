/**
 * Onboarding-flag unit tests.
 *
 * Pins the three behaviors the first-run dashboard rests on:
 *   • unset → false (fresh user sees onboarding),
 *   • mark → true, and idempotent (calling twice keeps it true),
 *   • hostile environments — no `window` (SSR) and a `localStorage` that throws —
 *     fall back to a boolean instead of crashing.
 *
 * Runs in the `node` jest environment, so `window` is undefined by default; we
 * install a fake `window.localStorage` per-case to exercise the browser paths.
 */

import { isOnboardingComplete, markOnboardingComplete } from './onboarding';

/** Minimal in-memory Storage stand-in — only the two methods we use. */
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** A Storage whose every access throws — models private mode / disabled storage. */
function makeThrowingStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled');
  };
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    get length(): number {
      return boom();
    },
  } as unknown as Storage;
}

const g = globalThis as { window?: unknown };

function setWindow(win: unknown): void {
  g.window = win;
}

afterEach(() => {
  delete g.window;
});

describe('isOnboardingComplete / markOnboardingComplete', () => {
  it('returns false when nothing has been marked', () => {
    setWindow({ localStorage: makeMemoryStorage() });
    expect(isOnboardingComplete()).toBe(false);
  });

  it('returns true after marking complete', () => {
    setWindow({ localStorage: makeMemoryStorage() });
    markOnboardingComplete();
    expect(isOnboardingComplete()).toBe(true);
  });

  it('is idempotent — marking twice stays complete', () => {
    setWindow({ localStorage: makeMemoryStorage() });
    markOnboardingComplete();
    markOnboardingComplete();
    expect(isOnboardingComplete()).toBe(true);
  });

  it('persists across a fresh storage read (same backing store)', () => {
    const storage = makeMemoryStorage();
    setWindow({ localStorage: storage });
    markOnboardingComplete();
    // simulate a reload: a new window object over the same storage
    setWindow({ localStorage: storage });
    expect(isOnboardingComplete()).toBe(true);
  });
});

describe('non-browser / SSR fallback', () => {
  it('returns false without a window and does not throw', () => {
    // no window installed (deleted in afterEach)
    expect(() => isOnboardingComplete()).not.toThrow();
    expect(isOnboardingComplete()).toBe(false);
  });

  it('mark is a silent no-op without a window', () => {
    expect(() => markOnboardingComplete()).not.toThrow();
  });
});

describe('storage-exception fallback', () => {
  it('returns false when localStorage access/read throws', () => {
    setWindow({ localStorage: makeThrowingStorage() });
    expect(() => isOnboardingComplete()).not.toThrow();
    expect(isOnboardingComplete()).toBe(false);
  });

  it('mark swallows a throwing setItem', () => {
    setWindow({ localStorage: makeThrowingStorage() });
    expect(() => markOnboardingComplete()).not.toThrow();
  });

  it('returns false when touching window.localStorage itself throws', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'localStorage', {
      get() {
        throw new Error('access denied');
      },
    });
    setWindow(hostile);
    expect(() => isOnboardingComplete()).not.toThrow();
    expect(isOnboardingComplete()).toBe(false);
  });
});
