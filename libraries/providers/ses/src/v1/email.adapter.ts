import * as crypto from 'crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { metadata as providerMetadata } from './metadata';
import {
  EmailCapability,
  EmailAdapterCapabilities,
  EmailSendParams,
  EmailSendResult,
  EmailWebhookEvent,
  EmailStatus,
  ProviderModule,
  SafeFetchPort,
  LoggerPort,
} from '@gitroom/provider-kernel';

// SES verifies/confirms SNS notifications by fetching the SubscribeURL and the
// signing certificate. Those outbound calls go through the kernel SafeFetchPort
// (the production safeFetch) instead of importing nestjs-libraries directly.
const noopLogger: LoggerPort = {
  log: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export class SesAdapter implements EmailCapability {
  readonly name = 'ses';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: true,
    openTracking: false,
    clickTracking: false,
  };
  readonly requiredEnvKeys = ['EMAIL_REGION', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];

  private _client: SESv2Client | null = null;
  private readonly _logger: LoggerPort;

  constructor(
    private readonly _fetch: SafeFetchPort,
    logger?: LoggerPort,
  ) {
    this._logger = logger ?? noopLogger;
  }

  private getClient(): SESv2Client {
    if (!this._client) {
      const region = process.env.EMAIL_REGION || 'us-east-1';
      const config: any = { region };
      if (process.env.EMAIL_SES_ACCESS_KEY_ID && process.env.EMAIL_SES_SECRET_ACCESS_KEY) {
        config.credentials = {
          accessKeyId: process.env.EMAIL_SES_ACCESS_KEY_ID,
          secretAccessKey: process.env.EMAIL_SES_SECRET_ACCESS_KEY,
        };
      }
      this._client = new SESv2Client(config);
    }
    return this._client;
  }

  isConfigured(): boolean {
    return !!process.env.EMAIL_REGION;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const client = this.getClient();
    const command = new SendEmailCommand({
      FromEmailAddress: `${params.fromName} <${params.fromAddress}>`,
      Destination: { ToAddresses: [params.to] },
      Content: {
        Simple: {
          Subject: { Data: params.subject },
          Body: { Html: { Data: params.html } },
        },
      },
      ...(params.replyTo ? { ReplyToAddresses: [params.replyTo] } : {}),
    });
    const response = await client.send(command);
    return { providerMessageId: response.MessageId };
  }

  async verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<boolean> {
    try {
      const payload = JSON.parse(rawBody.toString());
      const msgType = headers['x-amz-sns-message-type'];

      // Fail closed: webhooks are always enabled for this adapter, so the
      // TopicArn pin is mandatory. Without EMAIL_WEBHOOK_SECRET set we cannot
      // trust any topic — reject rather than accept-any (mail-DoS otherwise).
      const expectedTopic = process.env.EMAIL_WEBHOOK_SECRET || '';
      if (!expectedTopic) {
        this._logger.warn('SNS webhook rejected: EMAIL_WEBHOOK_SECRET (TopicArn pin) is not set');
        return false;
      }
      if (payload.TopicArn !== expectedTopic) return false;

      if (msgType === 'SubscriptionConfirmation') {
        const subscribeUrl = payload.SubscribeURL;
        if (!subscribeUrl || typeof subscribeUrl !== 'string') return false;

        if (!this._isValidSnsHost(new URL(subscribeUrl))) return false;

        // Verify the message signature before confirming the subscription —
        // an unsigned/forged confirmation must never self-confirm a topic.
        if (!(await this._verifySnsSignature(payload, msgType))) return false;

        try {
          const response = await this._fetch(subscribeUrl, { method: 'GET' });
          if (response.ok) {
            this._logger.log(`SNS SubscriptionConfirmation confirmed for ${payload.TopicArn}`);
          } else {
            this._logger.warn(`SNS SubscriptionConfirmation returned ${response.status} for ${payload.TopicArn}`);
          }
        } catch (err) {
          this._logger.warn(`SNS SubscriptionConfirmation fetch failed: ${(err as Error).message}`);
          return false;
        }
        return true;
      }

      if (msgType === 'Notification') {
        return this._verifySnsSignature(payload, msgType);
      }

      return false;
    } catch {
      return false;
    }
  }

  private _isValidSnsHost(url: URL): boolean {
    const hostname = url.hostname;
    return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(hostname);
  }

  private async _verifySnsSignature(payload: any, msgType?: string): Promise<boolean> {
    const certUrl = payload.SigningCertURL ?? payload.SigningCertUrl;
    if (!certUrl) return false;

    try {
      const certUrlParsed = new URL(certUrl);
      if (!this._isValidSnsHost(certUrlParsed)) return false;
    } catch {
      return false;
    }

    const signature = payload.Signature;
    if (!signature) return false;

    const signingString = this._buildSnsSigningString(payload, msgType);

    try {
      const certResponse = await this._fetch(certUrl, { method: 'GET' });
      if (!certResponse.ok) {
        this._logger.warn(`SNS cert fetch returned ${certResponse.status}`);
        return false;
      }
      const certPem = await certResponse.text();

      const algorithm = payload.SignatureVersion === '2' ? 'RSA-SHA256' : 'sha1WithRSAEncryption';
      const verified = crypto.verify(
        algorithm,
        Buffer.from(signingString),
        certPem,
        Buffer.from(signature, 'base64'),
      );

      return verified;
    } catch (err) {
      this._logger.warn(`SNS signature verification failed: ${(err as Error).message}`);
      return false;
    }
  }

  private _buildSnsSigningString(payload: any, msgType?: string): string {
    const lines: string[] = [];
    // SubscriptionConfirmation / UnsubscribeConfirmation sign a different set of
    // canonical fields (SubscribeURL + Token) than Notification (Subject).
    const isSubscription =
      msgType === 'SubscriptionConfirmation' ||
      msgType === 'UnsubscribeConfirmation';

    lines.push('Message');
    lines.push(payload.Message ?? '');
    lines.push('MessageId');
    lines.push(payload.MessageId ?? '');
    if (isSubscription) {
      lines.push('SubscribeURL');
      lines.push(payload.SubscribeURL ?? '');
    } else if (payload.Subject != null) {
      lines.push('Subject');
      lines.push(payload.Subject);
    }
    lines.push('Timestamp');
    lines.push(payload.Timestamp ?? '');
    if (isSubscription) {
      lines.push('Token');
      lines.push(payload.Token ?? '');
    }
    lines.push('TopicArn');
    lines.push(payload.TopicArn ?? '');
    lines.push('Type');
    lines.push(payload.Type ?? '');
    return lines.join('\n') + '\n';
  }

  parseWebhook(rawBody: Buffer, _headers: Record<string, string | undefined>): EmailWebhookEvent[] {
    try {
      const payload = JSON.parse(rawBody.toString());
      const message = JSON.parse(payload.Message || '{}');

      const notificationType: string = message.notificationType || '';
      const statusMap: Record<string, EmailStatus> = {
        Delivery: 'delivered',
        Bounce: 'bounced',
        Complaint: 'complained',
      };
      const status = statusMap[notificationType];
      if (!status) return [];

      const mail = message.mail || {};
      return [{
        providerMessageId: mail.messageId,
        recipient: mail.destination?.[0] || mail.commonHeaders?.to?.[0],
        status,
        occurredAt: new Date(mail.timestamp || Date.now()),
      }];
    } catch {
      return [];
    }
  }
}

const _meta: EmailCapability = new SesAdapter(
  undefined as unknown as SafeFetchPort,
);

export const sesEmailModule: ProviderModule<any, any> = {
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
  create: (rt) => new SesAdapter(rt.fetch, rt.logger),
};
