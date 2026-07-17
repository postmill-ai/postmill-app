import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EmailAdapterRegistry } from '@gitroom/nestjs-libraries/emails/email-adapter.registry';
import { EmailLogService } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { timer } from '@gitroom/helpers/utils/timer';

@Injectable()
export class EmailService {
  private readonly _logger = new Logger(EmailService.name);

  constructor(
    private _registry: EmailAdapterRegistry,
    private _emailLogService: EmailLogService,
  ) {}

  hasProvider() {
    const adapter = this._registry.getActiveAdapter();
    return adapter.name !== 'empty' && adapter.isConfigured();
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    addTo: 'top' | 'bottom',
    replyTo?: string,
  ) {
    if (!isInngestEnabled()) {
      this._logger.debug('Skipping email/send event — Inngest is disabled');
      return undefined;
    }

    // D3: deterministic id so a retried enqueue is deduplicated at the event
    // layer (matches the `post_${postId}` / `autopost-${id}` pattern). Bucketed
    // to the minute so legitimately re-sent identical mail later still goes out.
    // The body (html) is part of the digest so two DISTINCT same-minute mails with
    // an identical to+subject but different content — e.g. two password-reset
    // requests with rotated tokens — are NOT collapsed into one.
    const bucket = Math.floor(Date.now() / 60_000);
    const digest = createHash('sha256')
      .update(`${to}:${subject}:${html}`)
      .digest('hex')
      .slice(0, 32);

    return inngest.send({
      id: `email_${digest}_${bucket}`,
      name: 'email/send',
      data: { to, subject, html, replyTo, addTo },
    });
  }

  async sendEmailSync(
    to: string,
    subject: string,
    html: string,
    replyTo?: string,
  ) {
    if (to.indexOf('@') === -1) {
      return;
    }

    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      this._logger.warn('Email sender information not found in environment variables');
      return;
    }

    const modifiedHtml = `
    <div style="
        background: linear-gradient(to bottom right, #e6f2ff, #f0e6ff);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
    ">
        <div style="
            background-color: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(4px);
            border-radius: 0.5rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 48rem;
            width: 100%;
            padding: 2rem;
        ">
            <h1 style="
                font-size: 1.875rem;
                font-weight: bold;
                margin-bottom: 1.5rem;
                text-align: left;
                color: #1f2937;
            ">${subject}</h1>
            
            <div style="
                margin-bottom: 2rem;
                color: #374151;
            ">
                ${html}
            </div>
            
            <div style="
                display: flex;
                align-items: center;
                border-top: 1px solid #e5e7eb;
                padding-top: 1.5rem;
            ">
                <div>
                    <h2 style="
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #1f2937;
                        margin: 0;
                    ">${process.env.EMAIL_FROM_NAME}</h2>
                    <div style="font-size: 12px">
                      You can change your notification preferences in your <a href="${process.env.FRONTEND_URL}/settings">account settings.</a>
                     </div>
                </div>
            </div>
        </div>
    </div>
    `;

    const adapter = this._registry.getActiveAdapter();
    const log = await this._emailLogService.createLog({
      provider: adapter.name,
      toAddress: to,
      fromAddress: process.env.EMAIL_FROM_ADDRESS!,
      subject,
      replyTo,
    });

    // NOTIF-08: retry any provider error up to 3 times so transient failures
    // surface to Inngest for step-level retry. Business-level rejections are
    // still terminal once the attempts are exhausted.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await adapter.send({
          to,
          subject,
          html: modifiedHtml,
          fromName: process.env.EMAIL_FROM_NAME!,
          fromAddress: process.env.EMAIL_FROM_ADDRESS!,
          replyTo,
        });

        if (result.providerMessageId) {
          await this._emailLogService.markSent(log.id, result.providerMessageId, log.organizationId ?? null);
        } else {
          await this._emailLogService.markSent(log.id, 'no-id', log.organizationId ?? null);
        }

        return;
      } catch (err) {
        lastErr = err;
        const errorMsg = (err as Error)?.message || 'Unknown error';
        this._logger.warn(
          `Email attempt ${attempt + 1}/3 failed for recipient ${this._redactedId(to)}: ${errorMsg}`,
        );
        if (attempt < 2) {
          await timer(700);
        }
      }
    }

    const errorMsg = (lastErr as Error)?.message || 'Unknown error';
    this._logger.warn(`Email failed after 3 attempts for recipient ${this._redactedId(to)}: ${errorMsg}`);
    await this._emailLogService.markFailed(log.id, errorMsg, log.organizationId ?? null);
    throw lastErr;
  }

  private _redactedId(to: string): string {
    return createHash('sha256').update(to).digest('hex').slice(0, 12);
  }
}
