/* ────────────────────────────────────────────────────────────────────────────
 * Reset-password emails: verification-code mail (request stage) +
 * password-changed notice (confirm stage).
 *
 * Layout/token values are reused from the shared `account-email.layout` helper
 * (same single-column account-email shell as `find-id.template.ts`); nothing is
 * re-implemented here. The password-changed notice carries no value to surface,
 * so it omits the highlight box.
 *
 * All copy is fixed in `common/messages.ts` (MESSAGES.resetPassword.*); do not
 * improvise wording here.
 * ──────────────────────────────────────────────────────────────────────────── */

import { MESSAGES } from '../common/messages';
import {
  DEFAULT_SERVICE_NAME,
  renderContentHtml,
  renderContentText,
  type ContentEmailArgs,
  type RenderedEmail,
} from './account-email.layout';

export type { RenderedEmail };

/** Verification-code email (request stage, email channel). */
export function renderResetPasswordCodeEmail(input: {
  code: string;
  serviceName?: string;
}): RenderedEmail {
  const copy = MESSAGES.resetPassword.codeEmail;
  const serviceName = input.serviceName?.trim() || DEFAULT_SERVICE_NAME;
  const args: ContentEmailArgs = {
    serviceName,
    headline: copy.headline,
    bodyAbove: [copy.intro],
    highlight: input.code,
    highlightCaption: copy.expiry,
    bodyBelow: [],
    disclaimer: copy.disclaimer,
  };
  return { subject: copy.subject, html: renderContentHtml(args), text: renderContentText(args) };
}

/** Password-changed notice (confirm success, email channel) — no value to surface. */
export function renderResetPasswordDoneEmail(input: {
  serviceName?: string;
} = {}): RenderedEmail {
  const copy = MESSAGES.resetPassword.doneEmail;
  const serviceName = input.serviceName?.trim() || DEFAULT_SERVICE_NAME;
  const args: ContentEmailArgs = {
    serviceName,
    headline: copy.headline,
    bodyAbove: [copy.intro],
    bodyBelow: [copy.outro],
    disclaimer: copy.disclaimer,
  };
  return { subject: copy.subject, html: renderContentHtml(args), text: renderContentText(args) };
}
