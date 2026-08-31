import {
  CommsAdapterCapabilities,
  CommsCapability,
  CommsInboundMessage,
  CommsSendParams,
  CommsSendResult,
  ProviderModule,
  ProviderRuntimeContext,
  hmacSha256Hex,
  timingSafeStringEqual,
} from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const SLACK_API = 'https://slack.com/api';
const SIGNATURE_MAX_SKEW_SECONDS = 300;

const CAPABILITIES: CommsAdapterCapabilities = {
  webhookInbound: true,
  pollInbound: false,
  threads: true,
  webhookRegistration: false,
};

/**
 * Slack comms adapter — DMs via the bot token, inbound via the Events API
 * (signed with the app's signing secret). The Slack app needs the bot scopes
 * `chat:write`, `im:write`, `im:history` and the `message.im` event
 * subscription in addition to the posting scopes.
 */
export class SlackCommsAdapter implements CommsCapability {
  readonly name = 'slack';
  readonly capabilities = CAPABILITIES;

  constructor(private readonly _ctx: ProviderRuntimeContext) {}

  private get _botToken(): string {
    return this._ctx.credentials.botToken || '';
  }

  private async _api(method: string, body: Record<string, unknown>): Promise<any> {
    const response = await this._ctx.fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json: any = await response.json();
    if (!json?.ok) {
      throw new Error(`Slack ${method} failed: ${json?.error || response.status}`);
    }
    return json;
  }

  async sendDirectMessage(params: CommsSendParams): Promise<CommsSendResult> {
    let channel = params.externalChannelId;
    if (!channel) {
      const opened = await this._api('conversations.open', {
        users: params.externalUserId,
      });
      channel = opened.channel?.id;
    }
    const text = params.link ? `${params.text}\n${params.link}` : params.text;
    const posted = await this._api('chat.postMessage', { channel, text });
    return { messageId: posted.ts, externalChannelId: posted.channel || channel };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const signingSecret = this._ctx.credentials.signingSecret || '';
    const timestamp = headers['x-slack-request-timestamp'] || '';
    const signature = headers['x-slack-signature'] || '';
    if (!signingSecret || !timestamp || !signature) return false;
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skew) || skew > SIGNATURE_MAX_SKEW_SECONDS) return false;
    const expected = `v0=${hmacSha256Hex(signingSecret, `v0:${timestamp}:${rawBody.toString()}`)}`;
    return timingSafeStringEqual(expected, signature);
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
    if (payload?.type === 'url_verification') {
      return [{ kind: 'challenge', ackResponse: { challenge: payload.challenge } }];
    }
    if (payload?.type !== 'event_callback') {
      return [{ kind: 'ignore' }];
    }
    const event = payload.event;
    if (!event || (event.type !== 'message' && event.type !== 'app_mention')) {
      return [{ kind: 'ignore' }];
    }
    // Drop our own echoes and edits/joins — only fresh user-authored messages.
    if (event.bot_id || event.subtype || !event.user || !event.text) {
      return [{ kind: 'ignore' }];
    }
    return [
      {
        kind: 'message',
        externalUserId: event.user,
        externalChannelId: event.channel,
        text: event.text,
        messageId: payload.event_id || event.ts,
      },
    ];
  }

  async testConnection() {
    try {
      const json = await this._api('auth.test', {});
      return {
        ok: true,
        extra: {
          ...(json.team_id ? { teamId: String(json.team_id) } : {}),
          ...(json.user ? { botName: String(json.user) } : {}),
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async fetchIdentity(externalUserId: string): Promise<{ displayName?: string }> {
    try {
      const response = await this._ctx.fetch(
        `${SLACK_API}/users.info?user=${encodeURIComponent(externalUserId)}`,
        { headers: { Authorization: `Bearer ${this._botToken}` } },
      );
      const json: any = await response.json();
      return { displayName: json?.user?.real_name || json?.user?.name };
    } catch {
      return {};
    }
  }
}

export const slackCommsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'comms',
    providerId: 'slack',
    version: 'v1',
    displayName: 'Slack',
    status: 'active',
    authType: 'apiKey',
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        required: true,
        placeholder: 'xoxb-…',
        help: 'Slack API → your app → OAuth & Permissions → Bot User OAuth Token. Needs scopes chat:write, im:write, im:history.',
      },
      {
        key: 'signingSecret',
        label: 'Signing Secret',
        type: 'password',
        required: true,
        help: 'Slack API → your app → Basic Information → App Credentials → Signing Secret.',
      },
    ],
    capabilities: CAPABILITIES,
    setupNotes:
      'Enable Event Subscriptions with the webhook URL below and subscribe to the message.im bot event. One Postmill organization per Slack app.',
  },
  create: (ctx) => new SlackCommsAdapter(ctx),
};
