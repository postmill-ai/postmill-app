import Mailgun from 'mailgun.js';
import formData from 'form-data';
import { createHmac, timingSafeEqual } from 'crypto';
import { metadata as providerMetadata } from './metadata';
import {
  EmailCapability,
  EmailAdapterCapabilities,
  EmailSendParams,
  EmailSendResult,
  EmailWebhookEvent,
  EmailStatus,
  ProviderModule,
} from '@gitroom/provider-kernel';

export class MailgunAdapter implements EmailCapability {
  readonly name = 'mailgun';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: true,
    openTracking: true,
    clickTracking: true,
  };
  readonly requiredEnvKeys = ['EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_MAILGUN_DOMAIN'];

  private _client: ReturnType<typeof Mailgun.prototype.client> | null = null;

  private getClient() {
    if (!this._client) {
      const mg = new Mailgun(formData);
      const region = process.env.EMAIL_REGION === 'eu' ? 'eu' : 'us';
      this._client = mg.client({
        username: 'api',
        key: process.env.EMAIL_API_KEY || '',
        url: region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net',
      });
    }
    return this._client;
  }

  isConfigured(): boolean {
    return !!process.env.EMAIL_API_KEY && !!process.env.EMAIL_MAILGUN_DOMAIN;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const client = this.getClient();
    const domain = process.env.EMAIL_MAILGUN_DOMAIN!;
    const msg: any = {
      from: `${params.fromName} <${params.fromAddress}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    };
    if (params.replyTo) {
      msg['h:Reply-To'] = params.replyTo;
    }
    const body = await client.messages.create(domain, msg);
    return { providerMessageId: body.id || body.message };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const token = headers['x-mailgun-signature-token'];
    const timestamp = headers['x-mailgun-signature-timestamp'];
    const signature = headers['x-mailgun-signature-signature'];
    if (!token || !timestamp || !signature) return false;

    const apiKey = process.env.EMAIL_API_KEY || '';
    const hmac = createHmac('sha256', apiKey)
      .update(timestamp + token)
      .digest('hex');
    try {
      return timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  parseWebhook(rawBody: Buffer, _headers: Record<string, string | undefined>): EmailWebhookEvent[] {
    const payload = JSON.parse(rawBody.toString());
    const eventData = payload['event-data'] || {};
    const eventType = eventData.event || '';
    const statusMap: Record<string, EmailStatus> = {
      delivered: 'delivered',
      complained: 'complained',
      opened: 'opened',
      clicked: 'clicked',
    };

    if (eventType === 'failed') {
      if (eventData.severity === 'permanent') {
        return [{ providerMessageId: eventData.message?.headers?.['message-id'], recipient: eventData.recipient, status: 'bounced', occurredAt: new Date(eventData.timestamp * 1000) }];
      }
      return [];
    }

    const status = statusMap[eventType];
    if (!status) return [];

    return [{
      providerMessageId: eventData.message?.headers?.['message-id'],
      recipient: eventData.recipient,
      status,
      occurredAt: new Date(eventData.timestamp * 1000),
    }];
  }
}

const _meta: EmailCapability = new MailgunAdapter();

export const mailgunEmailModule: ProviderModule<any, any> = {
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
  create: () => new MailgunAdapter(),
};
