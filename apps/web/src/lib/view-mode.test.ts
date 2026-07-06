/**
 * Dashboard view-mode persistence unit tests.
 *
 * Pins the behaviors the view switcher rests on:
 *   • nothing stored → default ('list'),
 *   • write → read round-trips ('kanban' persists),
 *   • stale / garbage values fall back to the default (versioned-key hygiene),
 *   • hostile environments — no `window` (SSR) and a `localStorage` that throws —
 *     fall back to the default instead of crashing.
 *
 * Runs in the `node` jest environment, so `window` is undefined by default; we
 * install a fake `window.localStorage` per-case to exercise the browser paths.
 */

import { DEFAULT_VIEW_MODE, readViewMode, writeViewMode } from './view-mode';

/** Minimal in-memory Storage stand-in — only the methods we use. */
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

describe('readViewMode / writeViewMode', () => {
  it('defaults to list when nothing is stored', () => {
    setWindow({ localStorage: makeMemoryStorage() });
    expect(readViewMode()).toBe('list');
    expect(DEFAULT_VIEW_MODE).toBe('list');
  });

  it('round-trips a written view', () => {
    setWindow({ localStorage: makeMemoryStorage() });
    writeViewMode('kanban');
    expect(readViewMode()).toBe('kanban');
    writeViewMode('list');
    expect(readViewMode()).toBe('list');
  });

  it('falls back to the default for stale/garbage stored values', () => {
    const storage = makeMemoryStorage();
    storage.setItem('dashboard:v1:view-mode', 'timeline');
    setWindow({ localStorage: storage });
    expect(readViewMode()).toBe('list');
  });

  it('returns the default outside the browser (no window)', () => {
    // window is deleted by afterEach; readViewMode must not throw.
    expect(readViewMode()).toBe('list');
  });

  it('degrades to the default when storage throws, without crashing', () => {
    setWindow({ localStorage: makeThrowingStorage() });
    expect(readViewMode()).toBe('list');
    expect(() => writeViewMode('kanban')).not.toThrow();
    expect(readViewMode()).toBe('list');
  });
});
