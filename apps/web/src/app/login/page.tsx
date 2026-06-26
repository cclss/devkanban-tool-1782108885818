'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, Input } from '@repo/ui';
import { BlobBackground } from '@/components/blob-background';
import { PasswordInput } from '@/components/password-input';
import { GoogleButton } from '@/components/google-button';
import { AuthDivider } from '@/components/auth-divider';
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import { isAuthenticated, login, loginWithGoogle } from '@/lib/auth';
import { GoogleAuthError, useGoogleAuthCode } from '@/lib/google-oauth';

/** Pragmatic email shape check — the server is the real authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Secondary-link styling shared with find-id/signup ("아이디 찾기" / "회원가입"). */
const SECONDARY_LINK =
  'font-semibold text-primary underline-offset-4 hover:underline ' +
  'focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus';

type FieldErrors = { email?: string; password?: string };

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const trimmed = email.trim();
  if (!trimmed) {
    errors.email = '이메일을 입력해 주세요.';
  } else if (!EMAIL_RE.test(trimmed)) {
    errors.email = '이메일 형식을 다시 확인해 주세요.';
  }
  if (!password) {
    errors.password = '비밀번호를 입력해 주세요.';
  }
  return errors;
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Only surface inline field errors once the field has been engaged.
  const [touched, setTouched] = React.useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });

  // Google social sign-in (graceful no-op when the client id isn't configured).
  const { available: googleAvailable, requestCode } = useGoogleAuthCode();
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const [googleError, setGoogleError] = React.useState<string | null>(null);

  // While either auth path is in flight, the whole form is inert.
  const busy = submitting || googleLoading;

  // Already signed in → go straight to the dashboard (session established).
  React.useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/dashboard');
    }
  }, [router]);

  const revalidate = React.useCallback((nextEmail: string, nextPassword: string) => {
    setFieldErrors((prev) =>
      // Only refresh errors for fields the user has already touched, so we never
      // flash an error before they've had a chance to type.
      Object.keys(prev).length === 0 ? prev : validate(nextEmail, nextPassword),
    );
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setGoogleError(null);

    const errors = validate(email, password);
    setTouched({ email: true, password: true });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace('/dashboard');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : GENERIC_ERROR);
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setFormError(null);
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      const code = await requestCode();
      await loginWithGoogle(code);
      router.replace('/dashboard');
    } catch (error) {
      setGoogleError(
        error instanceof ApiError || error instanceof GoogleAuthError
          ? error.message
          : GENERIC_ERROR,
      );
      setGoogleLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-md py-2xl">
      <BlobBackground />

      <Card className="motion-stagger relative z-10 w-full max-w-[420px] p-xl shadow-lg sm:p-2xl">
        <header className="mb-xl flex flex-col gap-xs">
          <span className="text-sm font-bold tracking-tight text-primary">전자계약</span>
          <h1 className="text-2xl font-bold text-foreground">다시 오셨네요</h1>
          <p className="text-base text-foreground-subtle">
            이메일과 비밀번호로 로그인해 주세요.
          </p>
        </header>

        <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-lg">
          <Field label="이메일" htmlFor="email" error={touched.email ? fieldErrors.email : undefined}>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              invalid={touched.email && Boolean(fieldErrors.email)}
              aria-describedby={touched.email && fieldErrors.email ? 'email-message' : undefined}
              disabled={busy}
              onChange={(e) => {
                setEmail(e.target.value);
                setFormError(null);
                revalidate(e.target.value, password);
              }}
              onBlur={() => {
                setTouched((t) => ({ ...t, email: true }));
                setFieldErrors(validate(email, password));
              }}
            />
          </Field>

          <Field
            label="비밀번호"
            htmlFor="password"
            error={touched.password ? fieldErrors.password : undefined}
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="비밀번호"
              value={password}
              invalid={touched.password && Boolean(fieldErrors.password)}
              aria-describedby={
                touched.password && fieldErrors.password ? 'password-message' : undefined
              }
              disabled={busy}
              onChange={(e) => {
                setPassword(e.target.value);
                setFormError(null);
                revalidate(email, e.target.value);
              }}
              onBlur={() => {
                setTouched((t) => ({ ...t, password: true }));
                setFieldErrors(validate(email, password));
              }}
            />
          </Field>

          {formError ? (
            <p
              role="alert"
              className="rounded-md bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
            >
              {formError}
            </p>
          ) : null}

          <Button type="submit" size="lg" fullWidth isLoading={submitting} disabled={googleLoading}>
            {submitting ? '로그인 중' : '로그인'}
          </Button>
        </form>

        <div className="mt-lg flex flex-col gap-xs text-center text-sm text-foreground-subtle">
          <p>
            아이디가 기억나지 않으세요?{' '}
            <Link href="/find-id" className={SECONDARY_LINK}>
              아이디 찾기
            </Link>
          </p>
          <p>
            비밀번호를 잊으셨나요?{' '}
            <Link href="/reset-password" className={SECONDARY_LINK}>
              비밀번호 찾기
            </Link>
          </p>
        </div>

        {googleAvailable ? (
          <div className="mt-lg flex flex-col gap-md">
            <AuthDivider />
            {googleError ? (
              <p
                role="alert"
                className="rounded-md bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
              >
                {googleError}
              </p>
            ) : null}
            <GoogleButton
              label="Google로 로그인"
              isLoading={googleLoading}
              disabled={submitting}
              onClick={handleGoogle}
            />
          </div>
        ) : null}

        <p className="mt-xl text-center text-sm text-foreground-subtle">
          아직 계정이 없으신가요?{' '}
          <Link href="/signup" className={SECONDARY_LINK}>
            회원가입
          </Link>
        </p>
      </Card>
    </main>
  );
}
