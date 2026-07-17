import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { metadata as providerMetadata } from './metadata';
import {
  EmailCapability,
  EmailAdapterCapabilities,
  EmailSendParams,
  EmailSendResult,
  ProviderModule,
} from '@gitroom/provider-kernel';

export class SmtpAdapter implements EmailCapability {
  readonly name = 'smtp';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: false,
    openTracking: false,
    clickTracking: false,
  };
  readonly requiredEnvKeys = ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];

  private _transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this._transporter) {
      const auth: { user?: string; pass?: string } = {};
      if (process.env.EMAIL_SMTP_USER) auth.user = process.env.EMAIL_SMTP_USER;
      if (process.env.EMAIL_SMTP_PASS) auth.pass = process.env.EMAIL_SMTP_PASS;

      this._transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port: parseInt(process.env.EMAIL_SMTP_PORT || '587', 10),
        secure: process.env.EMAIL_SMTP_SECURE === 'true',
        ...(auth.user ? { auth } : {}),
      });
    }
    return this._transporter;
  }

  isConfigured(): boolean {
    return !!process.env.EMAIL_SMTP_HOST && !!process.env.EMAIL_SMTP_PORT;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const transporter = this.getTransporter();
    const info = await transporter.sendMail({
      from: `${params.fromName} <${params.fromAddress}>`,
      to: params.to,
      subject: params.subject,
      // Never put raw HTML into the text/plain part — derive a stripped-text
      // alternative so text-only clients don't render markup.
      text: this.htmlToText(params.html),
      html: params.html,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });
    return { providerMessageId: info.messageId };
  }

  private htmlToText(html: string): string {
    const stripTag = (s: string, tag: string) =>
      s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    let out = stripTag(stripTag(html, 'style'), 'script')
      .replace(/<\/(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n');
    let prev: string;
    do { prev = out; out = out.replace(/<[^>]*>/g, ''); } while (out !== prev);
    out = out
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
}

const _meta: EmailCapability = new SmtpAdapter();

export const smtpEmailModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'email',
    providerId: _meta.name,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: [],
    capabilities: _meta.capabilities,
  },
  create: () => new SmtpAdapter(),
};
