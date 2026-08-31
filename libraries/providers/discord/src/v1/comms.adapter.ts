import { createPublicKey, verify as cryptoVerify } from 'crypto';
import {
  CommsAdapterCapabilities,
  CommsCapability,
  CommsInboundMessage,
  CommsSendParams,
  CommsSendResult,
  ProviderModule,
  ProviderRuntimeContext,
} from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const DISCORD_API = 'https://discord.com/api/v10';

// DER SPKI prefix for a raw ed25519 public key (RFC 8410).
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const CAPABILITIES: CommsAdapterCapabilities = {
  webhookInbound: true,
  pollInbound: false,
  threads: true,
  webhookRegistration: false,
};

/**
 * Discord comms adapter. Inbound rides the Interactions endpoint (the
 * `/postmill` slash command, ed25519-signed); a slash command must be acked
 * with an interaction response within 3 seconds, so `parseInbound` attaches a
 * type-4 ephemeral ack and the real reply is delivered as a DM. `provision()`
 * upserts the global `/postmill` command.
 */
export class DiscordCommsAdapter implements CommsCapability {
  readonly name = 'discord';
  readonly capabilities = CAPABILITIES;

  constructor(private readonly _ctx: ProviderRuntimeContext) {}

  private async _api(
    path: string,
    init: { method?: string; body?: Record<string, unknown> } = {},
  ): Promise<any> {
    const response = await this._ctx.fetch(`${DISCORD_API}${path}`, {
      method: init.method || 'GET',
      headers: {
        Authorization: `Bot ${this._ctx.credentials.botToken || ''}`,
        'Content-Type': 'application/json',
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Discord ${path} failed: ${response.status} ${detail.slice(0, 200)}`);
    }
    return response.status === 204 ? undefined : response.json();
  }

  async sendDirectMessage(params: CommsSendParams): Promise<CommsSendResult> {
    let channel = params.externalChannelId;
    if (!channel) {
      const dm = await this._api('/users/@me/channels', {
        method: 'POST',
        body: { recipient_id: params.externalUserId },
      });
      channel = dm?.id;
    }
    const content = params.link ? `${params.text}\n${params.link}` : params.text;
    const message = await this._api(`/channels/${channel}/messages`, {
      method: 'POST',
      body: { content },
    });
    return { messageId: message?.id, externalChannelId: channel };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean {
    const publicKeyHex = this._ctx.credentials.publicKey || '';
    const signature = headers['x-signature-ed25519'] || '';
    const timestamp = headers['x-signature-timestamp'] || '';
    if (!publicKeyHex || !signature || !timestamp) return false;
    try {
      const key = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
        format: 'der',
        type: 'spki',
      });
      return cryptoVerify(
        null,
        Buffer.concat([Buffer.from(timestamp), rawBody]),
        key,
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  parseInbound(
    rawBody: Buffer,
    _headers: Record<string, string | undefined>,
  ): CommsInboundMessage[] {
    let interaction: any;
    try {
      interaction = JSON.parse(rawBody.toString());
    } catch {
      return [{ kind: 'ignore' }];
    }
    if (interaction?.type === 1) {
      return [{ kind: 'challenge', ackResponse: { type: 1 } }];
    }
    if (interaction?.type !== 2 || interaction?.data?.name !== 'postmill') {
      return [{ kind: 'ignore' }];
    }
    const user = interaction.member?.user || interaction.user;
    const text = interaction.data?.options?.find(
      (o: any) => o?.name === 'message',
    )?.value;
    if (!user?.id || !text) {
      return [{ kind: 'ignore' }];
    }
    return [
      {
        kind: 'message',
        externalUserId: user.id,
        text: String(text),
        messageId: interaction.id,
        // Slash commands demand an interaction response within 3s; the actual
        // agent reply arrives as a DM. flags 64 = ephemeral.
        ackResponse: {
          type: 4,
          data: {
            content: "🤖 Working on it — I'll DM you the answer.",
            flags: 64,
          },
        },
      },
    ];
  }

  async provision(): Promise<void> {
    const applicationId = this._ctx.credentials.applicationId || '';
    // POST with an existing name overwrites that command (no PUT — PUT replaces
    // the app's entire global command set).
    await this._api(`/applications/${applicationId}/commands`, {
      method: 'POST',
      body: {
        name: 'postmill',
        description: 'Chat with your Postmill agent',
        type: 1,
        options: [
          {
            type: 3,
            name: 'message',
            description: 'Your message to the agent',
            required: true,
          },
        ],
        integration_types: [0],
        contexts: [0, 1, 2],
      },
    });
  }

  async testConnection() {
    try {
      const me = await this._api('/users/@me');
      return {
        ok: true,
        extra: me?.username ? { botName: String(me.username) } : {},
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async fetchIdentity(externalUserId: string): Promise<{ displayName?: string }> {
    try {
      const user = await this._api(`/users/${externalUserId}`);
      return { displayName: user?.global_name || user?.username };
    } catch {
      return {};
    }
  }
}

export const discordCommsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'comms',
    providerId: 'discord',
    version: 'v1',
    displayName: 'Discord',
    status: 'active',
    authType: 'apiKey',
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        required: true,
        help: 'Discord Developer Portal → your app → Bot → Token.',
      },
      {
        key: 'applicationId',
        label: 'Application ID',
        type: 'string',
        required: true,
        help: 'Discord Developer Portal → your app → General Information → Application ID.',
      },
      {
        key: 'publicKey',
        label: 'Public Key',
        type: 'string',
        required: true,
        help: 'Discord Developer Portal → your app → General Information → Public Key.',
      },
    ],
    capabilities: CAPABILITIES,
    setupNotes:
      'Paste the webhook URL below into General Information → Interactions Endpoint URL. The /postmill command is registered automatically. One Postmill organization per Discord app.',
  },
  create: (ctx) => new DiscordCommsAdapter(ctx),
};
