import {
  CommsAdapterCapabilities,
  CommsCapability,
  CommsInboundMessage,
  CommsSendParams,
  CommsSendResult,
  ProviderModule,
  ProviderRuntimeContext,
  hmacSha256Base64,
  timingSafeStringEqual,
} from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const LINE_API = 'https://api.line.me/v2/bot';

const CAPABILITIES: CommsAdapterCapabilities = {
  webhookInbound: true,
  pollInbound: false,
  threads: false,
  webhookRegistration: false,
};

/**
 * LINE comms adapter. Outbound uses the 1:1 push-message API (NOT the
 * broadcast call the social adapter uses); inbound is the Messaging API
 * webhook, signed with the channel secret (X-Line-Signature).
 */
export class LineCommsAdapter implements CommsCapability {
  readonly name = 'line';
  readonly capabilities = CAPABILITIES;

  constructor(private readonly _ctx: ProviderRuntimeContext) {}

  async sendDirectMessage(params: CommsSendParams): Promise<CommsSendResult> {
    const text = params.link ? `${params.text}\n${params.link}` : params.text;
    const response = await this._ctx.fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._ctx.credentials.channelAccessToken || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.externalUserId,
        messages: [{ type: 'text', text }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`LINE push failed: ${response.status} ${detail.slice(0, 200)}`);
    }
    return { externalChannelId: params.externalUserId };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const channelSecret = this._ctx.credentials.channelSecret || '';
    const signature = headers['x-line-signature'] || '';
    if (!channelSecret || !signature) return false;
    return timingSafeStringEqual(hmacSha256Base64(channelSecret, rawBody), signature);
  }

  parseInbound(
    rawBody: Buffer,
    _headers: Record<string, string | undefined>,
  ): CommsInboundMessage[] {
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      return [{ kind: 'ignore' }];
    }
    const messages: CommsInboundMessage[] = [];
    for (const event of payload?.events || []) {
      if (
        event?.type !== 'message' ||
        event?.message?.type !== 'text' ||
        !event?.source?.userId ||
        !event?.message?.text
      ) {
        continue;
      }
      messages.push({
        kind: 'message',
        externalUserId: event.source.userId,
        externalChannelId: event.source.userId,
        text: event.message.text,
        messageId: event.message.id || event.webhookEventId,
      });
    }
    return messages.length ? messages : [{ kind: 'ignore' }];
  }

  async testConnection() {
    try {
      const response = await this._ctx.fetch(`${LINE_API}/info`, {
        headers: {
          Authorization: `Bearer ${this._ctx.credentials.channelAccessToken || ''}`,
        },
      });
      if (!response.ok) {
        return { ok: false, error: `LINE bot info failed: ${response.status}` };
      }
      const json: any = await response.json();
      return {
        ok: true,
        extra: json?.displayName ? { botName: String(json.displayName) } : {},
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async fetchIdentity(externalUserId: string): Promise<{ displayName?: string }> {
    try {
      const response = await this._ctx.fetch(
        `${LINE_API}/profile/${encodeURIComponent(externalUserId)}`,
        {
          headers: {
            Authorization: `Bearer ${this._ctx.credentials.channelAccessToken || ''}`,
          },
        },
      );
      const json: any = await response.json();
      return { displayName: json?.displayName };
    } catch {
      return {};
    }
  }
}

export const lineCommsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'comms',
    providerId: 'line',
    version: 'v1',
    displayName: 'LINE',
    status: 'active',
    authType: 'apiKey',
    credentialFields: [
      {
        key: 'channelAccessToken',
        label: 'Channel Access Token',
        type: 'password',
        required: true,
        help: 'LINE Developers Console → your Messaging API channel → Channel access token.',
      },
      {
        key: 'channelSecret',
        label: 'Channel Secret',
        type: 'password',
        required: true,
        help: 'LINE Developers Console → your channel → Basic settings → Channel secret.',
      },
    ],
    capabilities: CAPABILITIES,
    setupNotes:
      'Paste the webhook URL below into Messaging API → Webhook URL and enable "Use webhook". Users must add the bot as a friend before it can message them. One Postmill organization per channel.',
  },
  create: (ctx) => new LineCommsAdapter(ctx),
};
