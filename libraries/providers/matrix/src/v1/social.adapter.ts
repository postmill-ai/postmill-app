import {
  AuthTokenDetails,
  ChannelSetupDescriptor,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postmill-ai/provider-kernel';
import { makeId, makeOauthState } from '@postmill-ai/provider-kernel';
import { safeFetch, SocialAbstract } from '@postmill-ai/provider-kernel';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// Validate the user-supplied homeserver URL before it is interpolated into
// API calls (same posture as the peertube adapter): https only, bare origin,
// no IP literals. The outbound calls themselves go through the SSRF-hardened
// kernel fetch port.
function validateHomeserver(value: unknown): { ok: true; base: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Invalid homeserver URL' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'Invalid homeserver URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Homeserver URL must use HTTPS' };
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost') {
    return { ok: false, error: 'Invalid hostname' };
  }
  if (net.isIP(hostname)) {
    return { ok: false, error: 'IP addresses are not allowed' };
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, error: 'Homeserver URL must be a bare origin (no path or query)' };
  }
  return { ok: true, base: url.origin };
}

function assertMatrixBody(body: unknown): { base: string; accessToken: string; roomId: string } {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid credentials');
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.homeserverUrl !== 'string' ||
    typeof record.accessToken !== 'string' ||
    typeof record.roomId !== 'string' ||
    !record.homeserverUrl.trim() ||
    !record.accessToken.trim() ||
    !record.roomId.trim()
  ) {
    throw new Error('Invalid credentials');
  }
  const validation = validateHomeserver(record.homeserverUrl);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    base: validation.base,
    accessToken: record.accessToken,
    roomId: record.roomId,
  };
}

function parseMatrixCallback(token: string): { base: string; accessToken: string; roomId: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid credentials');
  }
  return assertMatrixBody(parsed);
}

// Content-Type for the media upload, derived from the file extension
// (info.mimetype is optional in m.image/m.video but improves rendering).
function guessMime(type: 'image' | 'video', path: string): string {
  const ext = (path.split('?')[0].split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  };
  return map[ext] || (type === 'image' ? 'image/jpeg' : 'video/mp4');
}

// Matrix Client-Server API (access-token auth). Verified against the Matrix
// Client-Server API (v3 paths, r0-identical shapes):
// - POST {hs}/_matrix/media/v3/upload — raw bytes → { content_uri }
// - PUT  {hs}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
//        { msgtype: 'm.text' | 'm.image' | 'm.video', ... } → { event_id }
// - GET  {hs}/_matrix/client/v3/account/whoami — token verification
export class MatrixProvider extends SocialAbstract implements SocialProvider {
  identifier = 'matrix';
  name = 'Matrix';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 2;
  toolTip = 'Enter your Matrix homeserver URL, access token and room ID.';

  // Homeserver + account-token channel: no developer app, no callback — the
  // channel connects with homeserver URL + access token + room ID in the
  // composer connect flow (customFields); the config form shows guidance only.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://matrix.org/docs/chat_basics/matrix-for-im/',
    portalLabel: 'Matrix for IM guide',
    setupSteps: [
      'You need a Matrix account (e.g. on matrix.org) and the room you want to post to. Create the room in your Matrix client (e.g. Element) if it does not exist yet.',
      'Get your access token: in Element, open Settings → Help & About → Advanced → Access Token and copy it. Treat it like a password — never share it. Do NOT log out of that session afterwards, or the token stops working.',
      'Get the room ID: in Element, open the room → Room settings → Advanced → "Internal room ID" (it looks like !abcdef:matrix.org).',
      'Back here, open Create new → New Channel → Matrix and enter your Homeserver URL (e.g. https://matrix.org), the Access Token and the Room ID, then click Connect.',
    ],
  };

  maxLength() {
    // The Matrix spec sets no message-length cap; homeservers enforce event
    // size limits (commonly ~64 KiB per event). 10000 keeps posts comfortably
    // inside every mainstream server's limit.
    return 10000;
  }

  async customFields() {
    return [
      {
        key: 'homeserverUrl',
        label: 'Homeserver URL',
        defaultValue: 'https://matrix.org',
        validation: `/^https:\\/\\/.+/`,
        type: 'text' as const,
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        validation: `/^.{8,}$/`,
        type: 'password' as const,
      },
      {
        key: 'roomId',
        label: 'Room ID',
        defaultValue: '!',
        validation: `/^!.+$/`,
        type: 'text' as const,
      },
    ];
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    // Matrix access tokens live until the session is logged out.
    return {
      id: '', name: '', username: '', picture: '',
      accessToken: '', refreshToken: '', expiresIn: 0,
    };
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return { url: state, codeVerifier: makeId(10), state };
  }

  // Connect-time verification: GET /_matrix/client/v3/account/whoami.
  async authenticate(params: { code: string; codeVerifier: string }) {
    let parsed: { base: string; accessToken: string; roomId: string };
    try {
      parsed = parseMatrixCallback(params.code);
    } catch (err) {
      return 'Invalid Matrix credentials';
    }
    const { base, accessToken } = parsed;

    const me = await (
      await this.fetch(`${base}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, this.identifier)
    ).json();

    if (!me?.user_id) {
      return 'Invalid Matrix access token or homeserver';
    }

    const localpart = String(me.user_id).split(':')[0].replace(/^@/, '');
    return {
      id: String(me.user_id),
      name: localpart || String(me.user_id),
      accessToken,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: '',
      username: String(me.user_id),
    };
  }

  override handleErrors(body: string, status: number) {
    // M_UNKNOWN_TOKEN / forbidden → the stored token is dead (logged-out
    // session) or lacks power in the room; surface as reconnect semantics.
    if (status === 401 || status === 403) {
      return {
        type: 'refresh-token' as const,
        value: 'Matrix access token was rejected — reconnect the channel with a fresh access token',
      };
    }
    return undefined;
  }

  private creds(integration: Integration) {
    return assertMatrixBody(
      JSON.parse(AuthService.fixedDecryption(integration.customInstanceDetails!))
    );
  }

  private async sendMessageEvent(
    base: string,
    accessToken: string,
    roomId: string,
    content: Record<string, unknown>
  ): Promise<string> {
    // txnId is an idempotency key, unique per event (makeId(32) = 128 bits).
    const txnId = makeId(32);
    const res = await (
      await this.fetch(
        `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(content),
        },
        this.identifier
      )
    ).json();
    return String(res?.event_id || '');
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    const { base, accessToken: token, roomId } = this.creds(integration);

    let firstEventId = '';

    const text = (first.message || '').slice(0, this.maxLength());
    if (text.trim()) {
      firstEventId = await this.sendMessageEvent(base, token, roomId, {
        msgtype: 'm.text',
        body: text,
      });
    }

    // Media: upload bytes first (POST /_matrix/media/v3/upload → mxc:// URI),
    // then reference the content_uri in an m.image/m.video message event.
    for (const media of first.media || []) {
      const blob = await safeFetch(media.path).then((r) => r.blob());
      const bytes = Buffer.from(await blob.arrayBuffer());
      const mimetype = guessMime(media.type, media.path);
      const filename = media.path.split('?')[0].split('/').pop() || 'file';

      const upload = await (
        await this.fetch(
          `${base}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': mimetype,
            },
            body: bytes,
          },
          this.identifier
        )
      ).json();

      const eventId = await this.sendMessageEvent(base, token, roomId, {
        msgtype: media.type === 'video' ? 'm.video' : 'm.image',
        body: media.alt || filename,
        url: upload.content_uri,
        info: { mimetype, size: bytes.length },
      });
      firstEventId = firstEventId || eventId;
    }

    return [
      {
        id: first.id,
        postId: firstEventId,
        // matrix.to is the standard spec-defined permalink service for events.
        releaseURL: firstEventId
          ? `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(firstEventId)}`
          : '',
        status: 'completed',
      },
    ];
  }
}

// ---- provider-kernel module ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

const __adapter = new MatrixProvider();

export const matrixSocialModule: __ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'social',
    providerId: __adapter.identifier,
    version: 'v1',
    displayName: __adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (__CAPS as any)[__adapter.identifier] || {},
  },
  create: (ctx) => new __Bridge(__adapter, ctx),
};
