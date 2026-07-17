export type EmailStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'opened'
  | 'clicked';

export interface EmailSendParams {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromAddress: string;
  replyTo?: string;
}

export interface EmailSendResult {
  providerMessageId?: string;
}

export interface EmailWebhookEvent {
  providerMessageId?: string;
  recipient?: string;
  status: EmailStatus;
  occurredAt: Date;
}

export interface EmailAdapterCapabilities {
  webhooks: boolean;
  openTracking: boolean;
  clickTracking: boolean;
}

export interface EmailCapability {
  name: string;
  capabilities: EmailAdapterCapabilities;
  requiredEnvKeys: string[];
  isConfigured(): boolean;
  send(params: EmailSendParams): Promise<EmailSendResult>;
  verifyWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>): boolean | Promise<boolean>;
  parseWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>): EmailWebhookEvent[];
}
