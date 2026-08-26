import { applyLocalePreference, getUser, setSession, updateLocale } from './auth';

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

type BrowserTestGlobals = {
  window?: EventTarget & { localStorage: Storage; location: { protocol: string } };
  document?: { cookie: string };
  localStorage?: Storage;
  fetch?: typeof fetch;
};
const globals = globalThis as unknown as BrowserTestGlobals;
const nativeFetch = globalThis.fetch;

afterEach(() => {
  delete globals.window;
  delete globals.document;
  delete globals.localStorage;
  if (nativeFetch) globals.fetch = nativeFetch;
  else delete globals.fetch;
});

describe('locale session persistence', () => {
  it('updates the stored session and notifies locale consumers as soon as /auth/locale succeeds', async () => {
    const storage = makeMemoryStorage();
    const windowTarget = new EventTarget() as EventTarget & {
      localStorage: Storage;
      location: { protocol: string };
    };
    windowTarget.localStorage = storage;
    windowTarget.location = { protocol: 'http:' };
    globals.window = windowTarget;
    globals.localStorage = storage;
    globals.document = { cookie: '' };
    globals.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'user_1',
        email: 'sender@example.com',
        name: 'Sender',
        plan: 'FREE',
        locale: 'en',
      }),
    });

    setSession({
      accessToken: 'before-update',
      user: { id: 'user_1', email: 'sender@example.com', name: 'Sender', plan: 'FREE', locale: 'ko' },
    });
    const onSessionChange = jest.fn();
    windowTarget.addEventListener('esign:session-change', onSessionChange);

    await expect(updateLocale('en')).resolves.toMatchObject({ id: 'user_1', locale: 'en' });

    expect(globals.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/auth/locale',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
        headers: expect.objectContaining({ Authorization: 'Bearer before-update' }),
      }),
    );
    expect(getUser()).toMatchObject({ id: 'user_1', locale: 'en' });
    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(globals.document?.cookie).toContain('esign_locale=en');
  });

  it('applies a locale optimistically without a network call and notifies consumers', () => {
    const storage = makeMemoryStorage();
    const windowTarget = new EventTarget() as EventTarget & {
      localStorage: Storage;
      location: { protocol: string };
    };
    windowTarget.localStorage = storage;
    windowTarget.location = { protocol: 'http:' };
    globals.window = windowTarget;
    globals.localStorage = storage;
    globals.document = { cookie: '' };
    const fetchSpy = jest.fn();
    globals.fetch = fetchSpy as unknown as typeof fetch;

    setSession({
      accessToken: 'token-1',
      user: { id: 'user_1', email: 'sender@example.com', name: 'Sender', plan: 'FREE', locale: 'ko' },
    });
    const onSessionChange = jest.fn();
    windowTarget.addEventListener('esign:session-change', onSessionChange);

    applyLocalePreference('en');

    // Immediate apply: stored user + SSR cookie flip and consumers are notified,
    // with no server round trip (that is updateLocale's job).
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getUser()).toMatchObject({ id: 'user_1', email: 'sender@example.com', locale: 'en' });
    expect(globals.document?.cookie).toContain('esign_locale=en');
    expect(onSessionChange).toHaveBeenCalledTimes(1);

    // Rollback path restores the previous locale the same way.
    applyLocalePreference('ko');
    expect(getUser()).toMatchObject({ id: 'user_1', locale: 'ko' });
    expect(globals.document?.cookie).toContain('esign_locale=ko');
    expect(onSessionChange).toHaveBeenCalledTimes(2);
  });

  it('mirrors the saved locale into an SSR-readable cookie on session set', () => {
    const storage = makeMemoryStorage();
    const windowTarget = new EventTarget() as EventTarget & {
      localStorage: Storage;
      location: { protocol: string };
    };
    windowTarget.localStorage = storage;
    windowTarget.location = { protocol: 'http:' };
    globals.window = windowTarget;
    globals.localStorage = storage;
    globals.document = { cookie: '' };

    setSession({
      accessToken: 'token-1',
      user: { id: 'user_1', email: 'sender@example.com', name: 'Sender', plan: 'FREE', locale: 'en' },
    });

    expect(globals.document.cookie).toContain('esign_locale=en');
  });
});
