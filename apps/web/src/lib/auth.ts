/**
 * Client-side session for the sender web app.
 *
 * The API returns the access token in the login response body (not a Set-Cookie),
 * so the browser owns it. We persist to `localStorage` as the source of truth and
 * mirror a non-HttpOnly cookie so a future server component / middleware (grain-5
 * dashboard) can read auth state during SSR. This module is the single place that
 * knows how the session is stored.
 */

import { apiFetch } from './api';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  plan: string;
}

export interface LoginResponse {
  accessToken: string;
  user: SessionUser;
}

const TOKEN_KEY = 'esign.token';
const USER_KEY = 'esign.user';
const COOKIE_NAME = 'esign_token';
/** Mirror cookie lifetime (7d) — auth lifetime is enforced server-side by the JWT. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function writeCookie(token: string): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function clearCookie(): void {
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Persist the session after a successful login. */
export function setSession(session: LoginResponse): void {
  if (!isBrowser()) return;
  localStorage.setItem(TOKEN_KEY, session.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  writeCookie(session.accessToken);
}

export function clearSession(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearCookie();
}

export function getToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

/** Authenticate and establish the session. Throws `ApiError` on failure. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const session = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    json: { email, password },
  });
  setSession(session);
  return session;
}

/**
 * Create an account and establish the session. The server returns the same
 * `{ accessToken, user }` shape as login, so registration logs the user in
 * immediately (no separate sign-in step). Throws `ApiError` on failure — e.g.
 * the email is already taken. */
export async function register(email: string, password: string): Promise<LoginResponse> {
  const session = await apiFetch<LoginResponse>('/auth/register', {
    method: 'POST',
    json: { email, password },
  });
  setSession(session);
  return session;
}

/**
 * Exchange a Google authorization `code` (from the GIS auth-code popup) for a
 * session. The server upserts the social account and returns the same
 * `{ accessToken, user }` shape as email login, so a successful Google sign-in
 * establishes the session identically — first-time users are created on the fly
 * (sign-up) and returning users are signed in. Throws `ApiError` on failure. */
export async function loginWithGoogle(code: string): Promise<LoginResponse> {
  const session = await apiFetch<LoginResponse>('/auth/google', {
    method: 'POST',
    json: { code },
  });
  setSession(session);
  return session;
}
