import sgMail from '@sendgrid/mail';
import { EventWebhook, EventWebhookHeader } from '@sendgrid/eventwebhook';
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

export class SendGridAdapter implements EmailCapability {
  readonly name = 'sendgrid';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: true,
    openTracking: true,
    clickTracking: true,
  };
  readonly requiredEnvKeys = ['EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];

  private _initialized = false;

  private ensureInit(): void {
    if (!this._initialized) {
      sgMail.setApiKey(process.env.EMAIL_API_KEY || '');
      this._initialized = true;
    }
  }

  isConfigured(): boolean {
    return !!process.env.EMAIL_API_KEY;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    this.ensureInit();
    const msg: any = {
      to: params.to,
      from: { email: params.fromAddress, name: params.fromName },
      subject: params.subject,
      html: params.html,
    };
    if (params.replyTo) {
      msg.replyTo = params.replyTo;
    }
    const [response] = await sgMail.send(msg);
    const messageId = response.headers['x-message-id'] as string | undefined;
    return { providerMessageId: messageId };
  }

  async verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<boolean> {
    try {
      const eventWebhook = new EventWebhook();
      const publicKey = eventWebhook.convertPublicKeyToECDSA(process.env.EMAIL_WEBHOOK_SECRET || '');
      const signature = headers[EventWebhookHeader.SIGNATURE()] || '';
      const timestamp = headers[EventWebhookHeader.TIMESTAMP()] || '';
      return eventWebhook.verifySignature(publicKey, rawBody.toString(), signature, timestamp);
    } catch {
      return false;
    }
  }

  parseWebhook(rawBody: Buffer, _headers: Record<string, string | undefined>): EmailWebhookEvent[] {
    const events: any[] = JSON.parse(rawBody.toString());
    const statusMap: Record<string, EmailStatus> = {
      delivered: 'delivered',
      bounce: 'bounced',
      dropped: 'failed',
      spamreport: 'complained',
      open: 'opened',
      click: 'clicked',
    };
    return events.map((e) => ({
      providerMessageId: e.sg_message_id?.split('.')[0],
      recipient: e.email,
      status: statusMap[e.event] || 'delivered',
      occurredAt: new Date((e.timestamp as number) * 1000),
    }));
  }
}

const _meta: EmailCapability = new SendGridAdapter();

export const sendgridEmailModule: ProviderModule<any, any> = {
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
  create: () => new SendGridAdapter(),
};
