import {
  CommsAdapterCapabilities,
  CommsCapability,
  CommsPollResult,
  CommsSendParams,
  CommsSendResult,
  ProviderModule,
  ProviderRuntimeContext,
} from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const CAPABILITIES: CommsAdapterCapabilities = {
  webhookInbound: false,
  pollInbound: true,
  threads: true,
  webhookRegistration: false,
};

// Priming call (null cursor): fetch no timeline at all — just learn next_batch.
const PRIMING_FILTER = JSON.stringify({
  room: { timeline: { limit: 0 } },
  presence: { types: [] },
  account_data: { types: [] },
});
// Steady state: message events only.
const MESSAGE_FILTER = JSON.stringify({
  room: { timeline: { types: ['m.room.message'] } },
  presence: { types: [] },
  account_data: { types: [] },
});

/**
 * Matrix comms adapter. No webhooks — inbound is a cursor long-poll over
 * /sync, driven by an Inngest cron. A null cursor performs a priming sync
 * (store next_batch, drop everything) so pre-existing room history is never
 * replayed into the agent.
 */
export class MatrixCommsAdapter implements CommsCapability {
  readonly name = 'matrix';
  readonly capabilities = CAPABILITIES;

  private _ownUserId: string | null = null;

  constructor(private readonly _ctx: ProviderRuntimeContext) {}

  private get _baseUrl(): string {
    const raw = (this._ctx.credentials.homeserverUrl || '').replace(/\/+$/, '');
    if (!raw.toLowerCase().startsWith('https://')) {
      throw new Error('Matrix homeserverUrl must be an https:// URL');
    }
    return raw;
  }

  private async _api(
    path: string,
    init: { method?: string; body?: Record<string, unknown> } = {},
  ): Promise<any> {
    const response = await this._ctx.fetch(
      `${this._baseUrl}/_matrix/client/v3${path}`,
      {
        method: init.method || 'GET',
        headers: {
          Authorization: `Bearer ${this._ctx.credentials.accessToken || ''}`,
          'Content-Type': 'application/json',
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        timeoutMs: 30000,
      },
    );
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Matrix ${path} failed: ${json?.errcode || response.status}`);
    }
    return json;
  }

  private async _whoami(): Promise<string> {
    if (!this._ownUserId) {
      const { user_id } = await this._api('/account/whoami');
      this._ownUserId = user_id;
    }
    return this._ownUserId!;
  }

  async sendDirectMessage(params: CommsSendParams): Promise<CommsSendResult> {
    let roomId = params.externalChannelId;
    if (!roomId) {
      const created = await this._api('/createRoom', {
        method: 'POST',
        body: {
          is_direct: true,
          preset: 'trusted_private_chat',
          invite: [params.externalUserId],
        },
      });
      roomId = created?.room_id;
    }
    const body = params.link ? `${params.text}\n${params.link}` : params.text;
    const txnId = `postmill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const sent = await this._api(
      `/rooms/${encodeURIComponent(roomId!)}/send/m.room.message/${txnId}`,
      { method: 'PUT', body: { msgtype: 'm.text', body } },
    );
    return { messageId: sent?.event_id, externalChannelId: roomId };
  }

  async pollInbound(cursor?: string): Promise<CommsPollResult> {
    if (!cursor) {
      const primed = await this._api(
        `/sync?timeout=0&filter=${encodeURIComponent(PRIMING_FILTER)}`,
      );
      return { messages: [], nextCursor: primed?.next_batch };
    }
    const ownUserId = await this._whoami();
    const sync = await this._api(
      `/sync?timeout=20000&since=${encodeURIComponent(cursor)}&filter=${encodeURIComponent(MESSAGE_FILTER)}`,
    );
    const messages: CommsPollResult['messages'] = [];
    const joined = sync?.rooms?.join || {};
    for (const [roomId, room] of Object.entries<any>(joined)) {
      for (const event of room?.timeline?.events || []) {
        if (
          event?.type !== 'm.room.message' ||
          event?.sender === ownUserId ||
          event?.content?.msgtype !== 'm.text' ||
          !event?.content?.body
        ) {
          continue;
        }
        messages.push({
          kind: 'message',
          externalUserId: event.sender,
          externalChannelId: roomId,
          text: event.content.body,
          messageId: event.event_id,
        });
      }
    }
    return { messages, nextCursor: sync?.next_batch || cursor };
  }

  async testConnection() {
    try {
      const who = await this._api('/account/whoami');
      return {
        ok: true,
        extra: who?.user_id ? { botUserId: String(who.user_id) } : {},
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async fetchIdentity(externalUserId: string): Promise<{ displayName?: string }> {
    try {
      const profile = await this._api(
        `/profile/${encodeURIComponent(externalUserId)}`,
      );
      return { displayName: profile?.displayname };
    } catch {
      return {};
    }
  }
}

export const matrixCommsModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'comms',
    providerId: 'matrix',
    version: 'v1',
    displayName: 'Matrix',
    status: 'active',
    authType: 'apiKey',
    credentialFields: [
      {
        key: 'homeserverUrl',
        label: 'Homeserver URL',
        type: 'string',
        required: true,
        placeholder: 'https://matrix.example.org',
        help: 'The https:// base URL of the homeserver the bot account lives on.',
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        required: true,
        help: 'An access token for the dedicated bot account (Element: Settings → Help & About → Access Token).',
      },
    ],
    capabilities: CAPABILITIES,
    setupNotes:
      'No webhook needed — Postmill polls the homeserver for new messages about once a minute. Use a dedicated bot account.',
  },
  create: (ctx) => new MatrixCommsAdapter(ctx),
};
