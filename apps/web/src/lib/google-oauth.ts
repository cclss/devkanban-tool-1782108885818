'use client';

/**
 * Lightweight Google Identity Services (GIS) integration for the auth screens.
 *
 * We load the GIS client script ourselves and drive the OAuth **auth-code popup
 * flow** (`accounts.oauth2.initCodeClient`, `ux_mode: 'popup'`) directly — no
 * React wrapper library, so there's no React 19 peer-dependency conflict to
 * resolve. The popup hands us a one-time authorization `code`; the backend
 * (grain-1 `POST /auth/google`) exchanges it against the `postmessage` redirect
 * URI and returns the same `{ accessToken, user }` session shape as email login.
 *
 * User-facing copy here mirrors the Toss tone of `messaging/auth`: never blame
 * the user, never leak internals, just point at the next step.
 */

import * as React from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** OIDC scopes — enough for the server to read a verified email + profile. */
const GIS_SCOPE = 'openid email profile';

/** Configured at build time. Empty string ⇒ Google sign-in is unavailable. */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/** Whether Google sign-in is configured for this build. */
export function isGoogleConfigured(): boolean {
  return GOOGLE_CLIENT_ID.trim().length > 0;
}

// --- Failure copy (client-side; Toss tone, matches messaging/auth) -----------

export type GoogleAuthErrorKind = 'cancelled' | 'popup_blocked' | 'connect';

const GOOGLE_AUTH_MESSAGES: Record<GoogleAuthErrorKind, string> = {
  cancelled: 'Google 로그인을 취소했어요. 다시 시도해 주세요.',
  popup_blocked: '팝업이 차단됐어요. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.',
  connect: 'Google에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

/**
 * A recoverable Google sign-in failure that happens *before* we reach our API
 * (popup dismissed/denied, popup blocked, or the GIS script never loaded). The
 * `message` is already user-facing copy, so callers can surface it verbatim —
 * the same way they surface an `ApiError.message`.
 */
export class GoogleAuthError extends Error {
  readonly kind: GoogleAuthErrorKind;

  constructor(kind: GoogleAuthErrorKind) {
    super(GOOGLE_AUTH_MESSAGES[kind]);
    this.name = 'GoogleAuthError';
    this.kind = kind;
  }
}

// --- Minimal GIS typings (only what we use) ----------------------------------

interface GisCodeResponse {
  code?: string;
  error?: string;
}

interface GisErrorResponse {
  /** e.g. 'popup_closed' | 'popup_failed_to_open'. */
  type?: string;
}

interface GisCodeClient {
  requestCode: () => void;
}

interface GoogleAccountsOAuth2 {
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode?: 'popup' | 'redirect';
    callback: (response: GisCodeResponse) => void;
    error_callback?: (error: GisErrorResponse) => void;
  }): GisCodeClient;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
    };
  }
}

// --- Script loader (single shared promise) -----------------------------------

let scriptPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new GoogleAuthError('connect'));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const onError = () => {
      // Allow a later retry to re-attempt the load.
      scriptPromise = null;
      reject(new GoogleAuthError('connect'));
    };

    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function mapGisError(error: GisErrorResponse): GoogleAuthError {
  if (error.type === 'popup_failed_to_open') return new GoogleAuthError('popup_blocked');
  // 'popup_closed' and anything else the user can recover from by retrying.
  return new GoogleAuthError('cancelled');
}

// --- Hook --------------------------------------------------------------------

export interface UseGoogleAuthCode {
  /** Whether a client id is configured (drives graceful degradation). */
  available: boolean;
  /** Whether the GIS script has finished loading (for snappier first click). */
  ready: boolean;
  /**
   * Open the Google popup and resolve with a one-time authorization `code`.
   * Rejects with a {@link GoogleAuthError} when the user dismisses/denies the
   * popup, the popup is blocked, or the GIS script fails to load.
   */
  requestCode: () => Promise<string>;
}

export function useGoogleAuthCode(): UseGoogleAuthCode {
  const available = isGoogleConfigured();
  const [ready, setReady] = React.useState(false);

  // Warm the script up front so the first click feels instant. Harmless no-op
  // when Google isn't configured or the script is already present.
  React.useEffect(() => {
    if (!available) return;
    let active = true;
    loadGis()
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        // Swallow here; requestCode() retries and surfaces the error then.
      });
    return () => {
      active = false;
    };
  }, [available]);

  const requestCode = React.useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!available) {
          reject(new GoogleAuthError('connect'));
          return;
        }
        loadGis()
          .then(() => {
            const oauth2 = window.google?.accounts?.oauth2;
            if (!oauth2) {
              reject(new GoogleAuthError('connect'));
              return;
            }
            let settled = false;
            const client = oauth2.initCodeClient({
              client_id: GOOGLE_CLIENT_ID,
              scope: GIS_SCOPE,
              ux_mode: 'popup',
              callback: (response) => {
                if (settled) return;
                settled = true;
                if (response.code) resolve(response.code);
                else reject(new GoogleAuthError('cancelled'));
              },
              error_callback: (error) => {
                if (settled) return;
                settled = true;
                reject(mapGisError(error));
              },
            });
            client.requestCode();
          })
          .catch((error) => {
            reject(error instanceof GoogleAuthError ? error : new GoogleAuthError('connect'));
          });
      }),
    [available],
  );

  return { available, ready, requestCode };
}
