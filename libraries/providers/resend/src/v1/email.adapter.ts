import { Resend } from 'resend';
import { Webhook } from 'svix';
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

export class ResendAdapter implements EmailCapability {
  readonly name = 'resend';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: true,
    openTracking: true,
    clickTracking: true,
  };
  readonly requiredEnvKeys = ['EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];

  private _client: Resend | null = null;

  private getClient(): Resend {
    if (!this._client) {
      this._client = new Resend(process.env.EMAIL_API_KEY || '');
    }
    return this._client;
  }

  isConfigured(): boolean {
    return !!process.env.EMAIL_API_KEY;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const resend = this.getClient();
    const from = `${params.fromName} <${params.fromAddress}>`;
    const sendParams: any = {
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    };
    if (params.replyTo) {
      sendParams.replyTo = params.replyTo;
    }
    const { data, error } = await resend.emails.send(sendParams);
    if (error) throw new Error((error as { message?: string })?.message || 'Resend send failed');
    return { providerMessageId: data?.id };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    try {
      const wh = new Webhook(process.env.EMAIL_WEBHOOK_SECRET || '');
      wh.verify(rawBody.toString(), {
        'svix-id': headers['svix-id'] || '',
        'svix-timestamp': headers['svix-timestamp'] || '',
        'svix-signature': headers['svix-signature'] || '',
      });
      return true;
    } catch {
      return false;
    }
  }

  parseWebhook(rawBody: Buffer, _headers: Record<string, string | undefined>): EmailWebhookEvent[] {
    const payload = JSON.parse(rawBody.toString());
    const event: { type: string; data: { email_id?: string; to?: string[] } } = payload;
    const statusMap: Record<string, EmailStatus> = {
      'email.delivered': 'delivered',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
    };
    const status = statusMap[event.type];
    if (!status) return [];
    return [{
      providerMessageId: event.data?.email_id,
      recipient: event.data?.to?.[0],
      status,
      occurredAt: new Date(),
    }];
  }
}

const _meta: EmailCapability = new ResendAdapter();

export const resendEmailModule: ProviderModule<any, any> = {
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
  create: () => new ResendAdapter(),
};
