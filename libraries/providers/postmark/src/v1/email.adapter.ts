import { ServerClient } from 'postmark';
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

export class PostmarkAdapter implements EmailCapability {
  readonly name = 'postmark';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: true,
    openTracking: true,
    clickTracking: true,
  };
  readonly requiredEnvKeys = ['EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];

  private _client: ServerClient | null = null;

  private getClient(): ServerClient {
    if (!this._client) {
      this._client = new ServerClient(process.env.EMAIL_API_KEY || '');
    }
    return this._client;
  }

  isConfigured(): boolean {
    return !!process.env.EMAIL_API_KEY;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const client = this.getClient();
    const response = await client.sendEmail({
      From: `${params.fromName} <${params.fromAddress}>`,
      To: params.to,
      Subject: params.subject,
      HtmlBody: params.html,
      ...(params.replyTo ? { ReplyTo: params.replyTo } : {}),
    });
    return { providerMessageId: response.MessageID };
  }

  verifyWebhook(_rawBody: Buffer, headers: Record<string, string | undefined>): boolean {
    const secret = process.env.EMAIL_WEBHOOK_SECRET;
    if (!secret) return false;

    const matchSecret = headers['x-postmark-secret'] || headers['x-secret'] || '';
    return matchSecret === secret;
  }

  parseWebhook(rawBody: Buffer, _headers: Record<string, string | undefined>): EmailWebhookEvent[] {
    const payload = JSON.parse(rawBody.toString());
    const type: string = payload.RecordType || '';
    const statusMap: Record<string, EmailStatus> = {
      Delivery: 'delivered',
      Bounce: 'bounced',
      SpamComplaint: 'complained',
      Open: 'opened',
      Click: 'clicked',
    };
    const status = statusMap[type];
    if (!status) return [];

    return [{
      providerMessageId: payload.MessageID,
      recipient: payload.Recipient,
      status,
      occurredAt: new Date(payload.ReceivedAt || payload.OccurredAt || Date.now()),
    }];
  }
}

const _meta: EmailCapability = new PostmarkAdapter();

export const postmarkEmailModule: ProviderModule<any, any> = {
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
  create: () => new PostmarkAdapter(),
};
