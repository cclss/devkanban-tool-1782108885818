import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRawMime, formatAddress, type MimeAttachment } from './mime';

/* ────────────────────────────────────────────────────────────────────────────
 * SES email sender (raw MIME, attachment-capable) with console fallback.
 *
 * Boundary: input = recipients + subject + body + attachment Buffers;
 * output = a send result. Mirrors `NotificationsService`'s degradation policy —
 * when `SES_FROM_EMAIL` is unset (or a send fails) it logs to the console and
 * NEVER throws, so the completion pipeline still finishes end-to-end locally.
 * No S3 / DB access here; attachment bytes arrive pre-built from the caller.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface EmailRecipient {
  email: string;
  name?: string | null;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  /** Defaults to application/pdf. */
  contentType?: string;
}

export interface EmailMessage {
  to: EmailRecipient[];
  subject: string;
  /** HTML body (preferred by clients). */
  html: string;
  /** Plain-text alternative (recommended for deliverability). */
  text?: string;
  attachments?: EmailAttachment[];
}

export type EmailDeliveryChannel = 'ses' | 'console';

export interface EmailSendResult {
  /** True when handed off to SES; false when it fell back to the console. */
  delivered: boolean;
  channel: EmailDeliveryChannel;
  /** Recipient addresses this message targeted. */
  recipients: string[];
  /** SES message id, when available. */
  messageId?: string;
  /** Reason for a console fallback, when applicable. */
  reason?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  /** Configured From address, or undefined when SES is not set up. */
  private get fromEmail(): string | undefined {
    return this.config.get<string>('SES_FROM_EMAIL') || undefined;
  }

  /** Optional friendly From name (e.g. service/sender brand). */
  private get fromName(): string | undefined {
    return this.config.get<string>('SES_FROM_NAME') || undefined;
  }

  private get region(): string | undefined {
    return this.config.get<string>('AWS_REGION') || undefined;
  }

  /** True when a From address is configured (real send path is possible). */
  get isConfigured(): boolean {
    return Boolean(this.fromEmail);
  }

  /**
   * Send one email to one or more recipients with optional attachments.
   * Never throws — returns a result describing how the message was handled.
   */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const recipients = message.to.map((r) => r.email.trim()).filter(Boolean);
    const from = this.fromEmail;

    if (!from) {
      return this.consoleFallback(message, recipients, 'SES_FROM_EMAIL 미설정');
    }
    if (recipients.length === 0) {
      // Nothing to send to — log and report rather than calling SES with no dest.
      return this.consoleFallback(message, recipients, '수신자 없음');
    }

    const attachments: MimeAttachment[] = (message.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }));

    const raw = buildRawMime({
      from: formatAddress(from, this.fromName),
      to: message.to.map((r) => formatAddress(r.email, r.name)),
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments,
    });

    try {
      const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
      const client = new SESv2Client({ region: this.region });
      const res = await client.send(
        new SendEmailCommand({
          FromEmailAddress: formatAddress(from, this.fromName),
          Destination: { ToAddresses: recipients },
          Content: { Raw: { Data: new Uint8Array(raw) } },
        }),
      );
      this.logger.log(
        `완료 이메일 발송 → ${recipients.join(', ')} (첨부 ${attachments.length}건) messageId=${res.MessageId ?? '-'}`,
      );
      return {
        delivered: true,
        channel: 'ses',
        recipients,
        messageId: res.MessageId,
      };
    } catch (err) {
      // Degrade gracefully — the pipeline should not fail because SES is down.
      return this.consoleFallback(message, recipients, `SES 발송 실패: ${String(err)}`);
    }
  }

  /** Send the same message to each recipient individually (per-recipient copy). */
  async sendEach(messages: EmailMessage[]): Promise<EmailSendResult[]> {
    return Promise.all(messages.map((m) => this.send(m)));
  }

  private consoleFallback(
    message: EmailMessage,
    recipients: string[],
    reason: string,
  ): EmailSendResult {
    const attachmentNames = (message.attachments ?? []).map((a) => a.filename).join(', ') || '없음';
    this.logger.log(
      `[이메일 폴백] (${reason}) → ${recipients.join(', ') || '수신자 없음'} ` +
        `제목="${message.subject}" 첨부=[${attachmentNames}]`,
    );
    return { delivered: false, channel: 'console', recipients, reason };
  }
}
