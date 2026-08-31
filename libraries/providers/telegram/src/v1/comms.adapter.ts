import {
  CommsAdapterCapabilities,
  CommsCapability,
  CommsInboundMessage,
  CommsSendParams,
  CommsSendResult,
  ProviderModule,
  ProviderRuntimeContext,
  timingSafeStringEqual,
} from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const CAPABILITIES: CommsAdapterCapabilities = {
  webhookInbound: true,
  pollInbound: false,
  threads: false,
  webhookRegistration: true,
};

/**
 * Telegram comms adapter. All calls go through ctx.fetch (safeFetch) — never
 * node-telegram-bot-api, whose transport bypasses SSRF validation. Inbound is
 * a webhook registered via setWebhook with a per-config secret token that
 * Telegram echoes back in X-Telegram-Bot-Api-Secret-Token.
 */
export class TelegramCommsAdapter implements CommsCapability {
  readonly name = 'telegram';
  readonly capabilities = CAPABILITIES;

  constructor(private readonly _ctx: ProviderRuntimeContext) {}

  private async _api(method: string, body?: Record<string, unknown>): Promise<any> {
    const token = this._ctx.credentials.botToken || '';
    const response = await this._ctx.fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      },
    );
    const json: any = await response.json();
    if (!json?.ok) {
      throw new Error(
        `Telegram ${method} failed: ${json?.description || response.status}`,
      );
    }
    return json.result;
  }

  async sendDirectMessage(params: CommsSendParams): Promise<CommsSendResult> {
    const text = params.link ? `${params.text}\n${params.link}` : params.text;
    const result = await this._api('sendMessage', {
      chat_id: params.externalUserId,
      text,
    });
    return {
      messageId: String(result?.message_id ?? ''),
      externalChannelId: params.externalUserId,
    };
  }

  verifyWebhook(
    _rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const secret = this._ctx.credentials.webhookSecret || '';
    const received = headers['x-telegram-bot-api-secret-token'] || '';
    if (!secret || !received) return false;
    return timingSafeStringEqual(secret, received);
  }

  parseInbound(
    rawBody: Buffer,
    _headers: Record<string, string | undefined>,
  ): CommsInboundMessage[] {
    let update: any;
    try {
      update = JSON.parse(rawBody.toString());
    } catch {
      return [{ kind: 'ignore' }];
    }
    const message = update?.message;
    if (!message || message.from?.is_bot || !message.text || !message.chat?.id) {
      return [{ kind: 'ignore' }];
    }
    const chatId = String(message.chat.id);
    return [
      {
        kind: 'message',
        externalUserId: chatId,
        externalChannelId: chatId,
        text: message.text,
        messageId: `${chatId}:${message.message_id}`,
      },
    ];
  }

  async registerWebhook(webhookUrl: string, secret: string): Promise<void> {
    await this._api('setWebhook', {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
    });
  }

  async testConnection() {
    try {
      const me = await this._api('getMe');
      return {
        ok: true,
        extra: me?.username ? { botUsername: String(me.username) } : {},
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async fetchIdentity(externalUserId: string): Promise<{ displayName?: string }> {
    try {
      const chat = await this._api('getChat', { chat_id: externalUserId });
      const displayName =
        [chat?.first_name, chat?.last_name].filter(Boolean).join(' ') ||
        chat?.username ||
        chat?.title;
      return { displayName };
    } catch {
      return {};
    }
  }
}

export const telegramCommsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'comms',
    providerId: 'telegram',
    version: 'v1',
    displayName: 'Telegram',
    status: 'active',
    authType: 'apiKey',
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        required: true,
        placeholder: '123456789:AA…',
        help: 'Create a bot with @BotFather and paste its token.',
      },
    ],
    capabilities: CAPABILITIES,
    setupNotes:
      'The webhook is registered automatically when you save. One Postmill organization per bot — pointing a second organization at the same bot re-routes its messages.',
  },
  create: (ctx) => new TelegramCommsAdapter(ctx),
};
