'use client';

/**
 * 비밀번호 재설정 (password reset) — a four-step, code-based recovery flow.
 *
 *   Step 1 (request): pick a channel (email / phone), enter the registered
 *     target, and request a 6-digit verification code.
 *   Step 2 (verify): enter the code to confirm identity. On success the server
 *     mints a single-use, short-lived reset token, which we keep ONLY in memory
 *     (component state) — never in the URL or localStorage.
 *   Step 3 (reset): set a new password (masked, with a live strength meter and a
 *     matching confirmation), then submit it with the held token.
 *   Step 4 (done): confirm the change and offer the way back to sign-in.
 *
 * Visual + interaction language is deliberately inherited from `find-id`: the
 * BlobBackground surface, a centered Card, `motion-stagger` entrance, a channel
 * segmented control, inline validation that only surfaces after a field is
 * touched, a form-level error banner (`role="alert"`, `bg-danger-subtle`),
 * `Button isLoading`, a resend cooldown, and the `SuccessCheck` finish. Step
 * transitions re-key the inner content so the stagger replays (it collapses
 * under `prefers-reduced-motion`, handled globally). Only `@repo/ui` primitives
 * and design tokens are used — no hardcoded colors or spacing.
 *
 * Security notes: the request endpoint returns the same generic acknowledgement
 * whether or not an account matched, so this UI never reveals account existence;
 * it simply advances to the code step. The reset token is short-lived and
 * single-use — once consumed (or expired) the server returns a single
 * unspecified "정보가 만료됐거나 더 이상 유효하지 않아요" message, surfaced in the
 * banner with an offer to start over.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, Input, StepIndicator, SuccessCheck, cn } from '@repo/ui';
import { BlobBackground } from '@/components/blob-background';
import { PasswordInput } from '@/components/password-input';
import { PasswordStrengthMeter } from '@/components/password-strength-meter';
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import {
  confirmResetPassword,
  requestResetPassword,
  verifyResetPassword,
  type ResetPasswordChannel,
} from '@/lib/reset-password';

/** Pragmatic email shape check — the server is the real authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canonical Korean mobile after normalization — mirrors the API `phone.ts`. */
const KOREAN_MOBILE_RE = /^01[016789]\d{7,8}$/;

const CODE_LENGTH = 6;
const CODE_RE = /^\d{6}$/;

/** Mirrors the server `ResetPasswordConfirmDto` bounds (`@MinLength(8)` /
 * `@MaxLength(72)` — bcrypt truncates past 72 bytes), so a password the client
 * accepts is one the server can set. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

/** Resend lock (seconds) — long enough to discourage mail-bombing, short
 * enough not to strand a user whose code never arrived. */
const RESEND_COOLDOWN_SECONDS = 30;

/** Secondary-link styling shared with login/signup/find-id ("로그인" 등). */
const SECONDARY_LINK =
  'font-semibold text-primary underline-offset-4 hover:underline ' +
  'focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus';

/** Tertiary in-flow action (resend / start over) — shared muted-text style. */
const TERTIARY_ACTION =
  'text-sm font-medium text-foreground-subtle underline-offset-4 ' +
  'transition-colors duration-fast ease-standard hover:text-foreground hover:underline ' +
  'focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus ' +
  'disabled:no-underline disabled:opacity-60 disabled:hover:text-foreground-subtle';

type ChannelMeta = {
  value: ResetPasswordChannel;
  /** Segmented-control label. */
  tab: string;
  /** Field label + input semantics. */
  fieldLabel: string;
  placeholder: string;
  inputType: React.HTMLInputTypeAttribute;
  inputMode: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete: string;
  /** Where the code was sent ("이메일" / "문자"), woven into guidance copy. */
  sentVia: string;
};

const CHANNEL_MAP: Record<ResetPasswordChannel, ChannelMeta> = {
  email: {
    value: 'email',
    tab: '이메일',
    fieldLabel: '이메일',
    placeholder: 'you@example.com',
    inputType: 'email',
    inputMode: 'email',
    autoComplete: 'email',
    sentVia: '이메일',
  },
  phone: {
    value: 'phone',
    tab: '휴대폰',
    fieldLabel: '휴대폰 번호',
    placeholder: '010-1234-5678',
    inputType: 'tel',
    inputMode: 'tel',
    autoComplete: 'tel',
    sentVia: '문자',
  },
};

/** Render order for the channel selector. */
const CHANNELS: readonly ChannelMeta[] = [CHANNEL_MAP.email, CHANNEL_MAP.phone];

/** Lightweight client check; the server normalizes (+82, hyphens) and decides. */
function isKoreanMobileLike(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  const domestic = digits.startsWith('82') ? `0${digits.slice(2).replace(/^0/, '')}` : digits;
  return KOREAN_MOBILE_RE.test(domestic);
}

function validateTarget(channel: ResetPasswordChannel, target: string): string | undefined {
  const trimmed = target.trim();
  if (channel === 'email') {
    if (!trimmed) return '이메일을 입력해 주세요.';
    if (!EMAIL_RE.test(trimmed)) return '이메일 형식을 다시 확인해 주세요.';
    return undefined;
  }
  if (!trimmed) return '휴대폰 번호를 입력해 주세요.';
  if (!isKoreanMobileLike(trimmed)) return '휴대폰 번호 형식을 다시 확인해 주세요.';
  return undefined;
}

function validateCode(code: string): string | undefined {
  // Same intent + tone as the server's `resetPassword.codeFormat`.
  return CODE_RE.test(code) ? undefined : '6자리 인증 코드를 정확히 입력해 주세요.';
}

function validatePassword(password: string): string | undefined {
  if (!password) return '새 비밀번호를 입력해 주세요.';
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상으로 설정해 주세요.`;
  if (password.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하로 입력해 주세요.`;
  return undefined;
}

function validateConfirm(password: string, confirm: string): string | undefined {
  if (!confirm) return '비밀번호를 한 번 더 입력해 주세요.';
  // Same wording as the server's `passwordConfirm` mismatch message (grain-3).
  if (password !== confirm) return '비밀번호가 일치하지 않아요. 다시 확인해 주세요.';
  return undefined;
}

/** Join non-empty `aria-describedby` ids, or `undefined` if there are none. */
function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

type Step = 'request' | 'verify' | 'reset' | 'done';

export default function ResetPasswordPage() {
  const router = useRouter();

  const [step, setStep] = React.useState<Step>('request');
  const [channel, setChannel] = React.useState<ResetPasswordChannel>('email');
  const [target, setTarget] = React.useState('');
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [passwordConfirm, setPasswordConfirm] = React.useState('');

  // Single-use reset token from `verify`. Memory-only — never URL/localStorage.
  const [resetToken, setResetToken] = React.useState('');

  const [targetError, setTargetError] = React.useState<string | undefined>();
  const [targetTouched, setTargetTouched] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | undefined>();
  const [passwordError, setPasswordError] = React.useState<string | undefined>();
  const [passwordTouched, setPasswordTouched] = React.useState(false);
  const [confirmError, setConfirmError] = React.useState<string | undefined>();
  const [confirmTouched, setConfirmTouched] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [requesting, setRequesting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [resendNotice, setResendNotice] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);

  const channelMeta = CHANNEL_MAP[channel];
  const codeInputRef = React.useRef<HTMLInputElement>(null);
  const passwordInputRef = React.useRef<HTMLInputElement>(null);

  // Already signed in → reset is moot; mirror find-id/login and hand off.
  React.useEffect(() => {
    if (isAuthenticated()) router.replace('/dashboard');
  }, [router]);

  // Resend cooldown ticker — counts down once per second while > 0.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  // Move focus into the field that just appeared, per step.
  React.useEffect(() => {
    if (step === 'verify') codeInputRef.current?.focus();
    if (step === 'reset') passwordInputRef.current?.focus();
  }, [step]);

  const startCooldown = React.useCallback(() => setCooldown(RESEND_COOLDOWN_SECONDS), []);

  function selectChannel(next: ResetPasswordChannel) {
    if (next === channel) return;
    // Email and phone are different inputs — reset the target rather than carry
    // a value that's invalid for the new channel.
    setChannel(next);
    setTarget('');
    setTargetError(undefined);
    setTargetTouched(false);
    setFormError(null);
  }

  /** Wipe verification + new-password state and return to the first step. Used
   * after the reset token has died (expired / consumed) so the user restarts
   * cleanly from identity verification. */
  function restart() {
    setStep('request');
    setCode('');
    setCodeError(undefined);
    setPassword('');
    setPasswordConfirm('');
    setResetToken('');
    setPasswordError(undefined);
    setPasswordTouched(false);
    setConfirmError(undefined);
    setConfirmTouched(false);
    setFormError(null);
    setResendNotice(null);
  }

  async function handleRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const err = validateTarget(channel, target);
    setTargetTouched(true);
    setTargetError(err);
    if (err) return;

    setRequesting(true);
    try {
      await requestResetPassword(channel, target.trim());
      setStep('verify');
      setCode('');
      setCodeError(undefined);
      startCooldown();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : GENERIC_ERROR);
    } finally {
      setRequesting(false);
    }
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setResendNotice(null);

    const err = validateCode(code);
    setCodeError(err);
    if (err) return;

    setVerifying(true);
    try {
      const result = await verifyResetPassword(channel, target.trim(), code);
      setResetToken(result.resetToken);
      setStep('reset');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : GENERIC_ERROR);
      setCode('');
    } finally {
      setVerifying(false);
    }
  }

  async function handleConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const pwErr = validatePassword(password);
    const confirmErr = validateConfirm(password, passwordConfirm);
    setPasswordTouched(true);
    setConfirmTouched(true);
    setPasswordError(pwErr);
    setConfirmError(confirmErr);
    if (pwErr || confirmErr) return;

    setConfirming(true);
    try {
      await confirmResetPassword(resetToken, password);
      setStep('done');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : GENERIC_ERROR);
    } finally {
      setConfirming(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setFormError(null);
    setResendNotice(null);
    setResending(true);
    try {
      await requestResetPassword(channel, target.trim());
      setCode('');
      setCodeError(undefined);
      startCooldown();
      setResendNotice('인증 코드를 다시 보냈어요.');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : GENERIC_ERROR);
    } finally {
      setResending(false);
    }
  }

  function backToRequest() {
    setStep('request');
    setCode('');
    setCodeError(undefined);
    setFormError(null);
    setResendNotice(null);
  }

  const busyRequest = requesting;
  const busyVerify = verifying || resending;

  const stepIndex = step === 'request' ? 0 : step === 'verify' ? 1 : 2;

  const headerCopy =
    step === 'request'
      ? '가입하신 이메일 또는 휴대폰 번호로 본인 확인을 해주세요.'
      : step === 'verify'
        ? `${target.trim()}(으)로 보낸 6자리 인증 코드를 입력해 주세요.`
        : '본인 확인이 끝났어요. 새 비밀번호를 설정해 주세요.';

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-md py-2xl">
      <BlobBackground />

      <Card className="relative z-10 w-full max-w-[420px] p-xl shadow-lg sm:p-2xl">
        {step === 'done' ? (
          <div key="done" className="motion-stagger flex flex-col items-center gap-md text-center">
            <SuccessCheck />
            <div role="status" aria-live="polite" className="flex flex-col gap-xs">
              <h1 className="text-2xl font-bold text-foreground">비밀번호 변경이 완료되었습니다!</h1>
              <p className="text-base text-foreground-subtle">
                새 비밀번호로 다시 로그인해 주세요.
              </p>
            </div>

            <Button asChild size="lg" fullWidth className="mt-xs">
              <Link href="/login">로그인하러 가기</Link>
            </Button>
          </div>
        ) : (
          <div key={step} className="motion-stagger flex flex-col">
            <header className="mb-xl flex flex-col gap-xs">
              <span className="text-sm font-bold tracking-tight text-primary">전자계약</span>
              <h1 className="text-2xl font-bold text-foreground">비밀번호 재설정</h1>
              <p className="text-base text-foreground-subtle">{headerCopy}</p>
            </header>

            <StepIndicator
              className="mb-xl"
              steps={['본인 인증', '코드 확인', '새 비밀번호']}
              current={stepIndex}
            />

            {step === 'request' ? (
              <form noValidate onSubmit={handleRequest} className="flex flex-col gap-lg">
                <div className="flex flex-col gap-xs">
                  <span className="text-sm font-semibold text-foreground-muted">인증 방법</span>
                  <div
                    role="radiogroup"
                    aria-label="인증 방법"
                    className="grid grid-cols-2 gap-2xs rounded-lg bg-surface-muted p-2xs"
                  >
                    {CHANNELS.map((c) => (
                      <label key={c.value} className="cursor-pointer">
                        <input
                          type="radio"
                          name="channel"
                          value={c.value}
                          checked={channel === c.value}
                          disabled={busyRequest}
                          onChange={() => selectChannel(c.value)}
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            'flex h-10 items-center justify-center rounded-md text-sm font-semibold',
                            'transition-colors duration-fast ease-standard',
                            'text-foreground-subtle peer-hover:text-foreground',
                            'peer-checked:bg-surface peer-checked:text-foreground peer-checked:shadow-sm',
                            'peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-focus',
                          )}
                        >
                          {c.tab}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <Field
                  label={channelMeta.fieldLabel}
                  htmlFor="target"
                  error={targetTouched ? targetError : undefined}
                >
                  <Input
                    id="target"
                    name="target"
                    type={channelMeta.inputType}
                    inputMode={channelMeta.inputMode}
                    autoComplete={channelMeta.autoComplete}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional entry focus
                    autoFocus
                    placeholder={channelMeta.placeholder}
                    value={target}
                    invalid={targetTouched && Boolean(targetError)}
                    aria-describedby={targetTouched && targetError ? 'target-message' : undefined}
                    disabled={busyRequest}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setFormError(null);
                      if (targetTouched) setTargetError(validateTarget(channel, e.target.value));
                    }}
                    onBlur={() => {
                      setTargetTouched(true);
                      setTargetError(validateTarget(channel, target));
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

                <Button type="submit" size="lg" fullWidth isLoading={requesting}>
                  {requesting ? '인증 요청 중' : '본인 인증 요청'}
                </Button>
              </form>
            ) : step === 'verify' ? (
              <form noValidate onSubmit={handleVerify} className="flex flex-col gap-lg">
                <Field
                  label="인증 코드"
                  htmlFor="code"
                  hint={
                    codeError
                      ? undefined
                      : `${channelMeta.sentVia}로 받은 ${CODE_LENGTH}자리 숫자를 입력해 주세요.`
                  }
                  error={codeError}
                >
                  <Input
                    ref={codeInputRef}
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d*"
                    maxLength={CODE_LENGTH}
                    placeholder="000000"
                    className="text-center text-lg font-semibold tabular-nums tracking-[0.4em]"
                    value={code}
                    invalid={Boolean(codeError)}
                    aria-describedby="code-message"
                    disabled={busyVerify}
                    onChange={(e) => {
                      const next = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
                      setCode(next);
                      setFormError(null);
                      if (codeError) setCodeError(validateCode(next));
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

                <Button type="submit" size="lg" fullWidth isLoading={verifying} disabled={resending}>
                  {verifying ? '확인 중' : '확인'}
                </Button>

                <div className="flex flex-col items-center gap-2xs">
                  <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-success">
                    {resendNotice}
                  </p>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={cooldown > 0 || busyVerify}
                    className={TERTIARY_ACTION}
                  >
                    {cooldown > 0
                      ? `코드 재전송 (${cooldown}초)`
                      : resending
                        ? '코드 재전송 중…'
                        : '코드 재전송'}
                  </button>
                  <button
                    type="button"
                    onClick={backToRequest}
                    disabled={busyVerify}
                    className={TERTIARY_ACTION}
                  >
                    입력 정보 다시 확인하기
                  </button>
                </div>
              </form>
            ) : (
              <form noValidate onSubmit={handleConfirm} className="flex flex-col gap-lg">
                <Field
                  label="새 비밀번호"
                  htmlFor="password"
                  error={passwordTouched ? passwordError : undefined}
                  hint={
                    passwordTouched && passwordError
                      ? undefined
                      : '8자 이상으로 설정해 주세요. 영문·숫자·기호를 섞으면 더 안전해요.'
                  }
                >
                  <PasswordInput
                    ref={passwordInputRef}
                    id="password"
                    name="new-password"
                    autoComplete="new-password"
                    placeholder="새 비밀번호"
                    maxLength={PASSWORD_MAX}
                    value={password}
                    invalid={passwordTouched && Boolean(passwordError)}
                    aria-describedby={describedBy(
                      'password-strength',
                      passwordTouched && passwordError && 'password-message',
                    )}
                    disabled={confirming}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPassword(next);
                      setFormError(null);
                      if (passwordTouched) setPasswordError(validatePassword(next));
                      if (confirmTouched) setConfirmError(validateConfirm(next, passwordConfirm));
                    }}
                    onBlur={() => {
                      setPasswordTouched(true);
                      setPasswordError(validatePassword(password));
                    }}
                  />
                  <PasswordStrengthMeter password={password} id="password-strength" />
                </Field>

                <Field
                  label="새 비밀번호 확인"
                  htmlFor="passwordConfirm"
                  error={confirmTouched ? confirmError : undefined}
                >
                  <PasswordInput
                    id="passwordConfirm"
                    name="confirm-password"
                    autoComplete="new-password"
                    placeholder="새 비밀번호 다시 입력"
                    maxLength={PASSWORD_MAX}
                    value={passwordConfirm}
                    invalid={confirmTouched && Boolean(confirmError)}
                    aria-describedby={
                      confirmTouched && confirmError ? 'passwordConfirm-message' : undefined
                    }
                    disabled={confirming}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPasswordConfirm(next);
                      setFormError(null);
                      if (confirmTouched) setConfirmError(validateConfirm(password, next));
                    }}
                    onBlur={() => {
                      setConfirmTouched(true);
                      setConfirmError(validateConfirm(password, passwordConfirm));
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

                <Button type="submit" size="lg" fullWidth isLoading={confirming}>
                  {confirming ? '변경 중' : '비밀번호 변경'}
                </Button>

                <div className="flex flex-col items-center gap-2xs">
                  <button
                    type="button"
                    onClick={restart}
                    disabled={confirming}
                    className={TERTIARY_ACTION}
                  >
                    처음부터 다시 시작하기
                  </button>
                </div>
              </form>
            )}

            <p className="mt-xl text-center text-sm text-foreground-subtle">
              비밀번호가 기억나시나요?{' '}
              <Link href="/login" className={SECONDARY_LINK}>
                로그인
              </Link>
            </p>
          </div>
        )}
      </Card>
    </main>
  );
}
