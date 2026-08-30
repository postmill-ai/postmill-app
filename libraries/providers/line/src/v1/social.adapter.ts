import {
  AnalyticsData,
  AuthTokenDetails,
  ChannelSetupDescriptor,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postmill-ai/provider-kernel';
import { makeId, makeOauthState } from '@postmill-ai/provider-kernel';
import { SocialAbstract, ValidityMedia } from '@postmill-ai/provider-kernel';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import { randomUUID } from 'crypto';

import { metadata as providerMetadata } from './metadata';

// LINE Messaging API (channel access token auth — the token IS the credential,
// exactly the telegram pattern; no OAuth callback is involved).
// Verified against https://developers.line.biz/en/reference/messaging-api/ :
// - POST https://api.line.me/v2/bot/message/broadcast — {messages:[...]} (max 5),
//   200 with an empty JSON object (no message id is returned).
// - GET  https://api.line.me/v2/bot/info — bot identity (token verification).
// - GET  https://api.line.me/v2/bot/insight/followers?date=yyyyMMdd — friend count.
export class LineProvider extends SocialAbstract implements SocialProvider {
  identifier = 'line';
  name = 'LINE';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  // Broadcast + insight endpoints are limited to 60 requests/hour per channel.
  override maxConcurrentJob = 2;

  // Channel-access-token channel: no developer app beyond the LINE Official
  // Account's Messaging API channel, no callback — the token (stored on the
  // org config's clientId) is the credential.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'token',
    credentialFields: [
      {
        key: 'clientId',
        label: 'Channel Access Token',
        placeholder: 'e.g. AbCdEfGh.../very-long-token',
        secret: true,
        help: 'LINE Developers Console → your provider → your Messaging API channel → Messaging API settings → Channel access token (long-lived)',
      },
    ],
    portalUrl: 'https://developers.line.biz/console/',
    portalLabel: 'LINE Developers Console',
    setupSteps: [
      'Open the LINE Developers Console and sign in with your LINE account. Create a Provider if you do not have one yet.',
      'Create a channel of type "Messaging API" (or pick your existing one) — this is your LINE Official Account.',
      'On the channel\'s "Messaging API settings" tab, scroll to "Channel access token" and issue a long-lived token, then copy it into the field below.',
      'Open your LINE Official Account in the LINE app and add it as a friend so broadcasts reach you; every friend of the account receives the posts.',
    ],
  };

  maxLength() {
    // LINE text message cap (Messaging API reference, Text message object).
    return 5000;
  }

  // Token-only credential: the org config stores the channel access token in
  // clientId; the platform env fallback (LINE_CHANNEL_ACCESS_TOKEN) surfaces it
  // as `token`. At publish time fall back to the stored accessToken.
  private resolveToken(accessToken?: string, clientInformation?: ClientInformation): string {
    return (
      clientInformation?.client_id ||
      clientInformation?.token ||
      accessToken ||
      ''
    );
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    // Long-lived channel access tokens do not expire/refresh.
    return {
      id: '', name: '', username: '', picture: '',
      accessToken: '', refreshToken: '', expiresIn: 0,
    };
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return { url: state, codeVerifier: makeId(10), state };
  }

  // Connect-time verification: GET /v2/bot/info with the channel access token.
  async authenticate(
    params: { code: string; codeVerifier: string; refresh?: string },
    clientInformation?: ClientInformation
  ) {
    const token = this.resolveToken(undefined, clientInformation);
    if (!token) {
      return 'Channel access token is required';
    }

    const info = await (
      await this.fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${token}` },
      }, this.identifier)
    ).json();

    if (!info?.userId) {
      return 'Invalid LINE channel access token';
    }

    return {
      id: String(info.userId),
      name: info.displayName || info.basicId || 'LINE Official Account',
      accessToken: token,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: info.pictureUrl || '',
      username: info.basicId || String(info.userId),
    };
  }

  // LINE image/video messages are sent by public URL only — the platform
  // fetches the content itself, so every attachment must be a public HTTPS URL.
  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    for (const post of posts) {
      for (const media of post || []) {
        if (!media.path?.startsWith('https://')) {
          return 'LINE can only publish media hosted on a public https URL';
        }
      }
    }
    return true;
  }

  override handleErrors(body: string, status: number) {
    if (status === 401 || status === 403) {
      return {
        type: 'refresh-token' as const,
        value: 'LINE channel access token was rejected — reconnect the channel with a valid token',
      };
    }
    return undefined;
  }

  private buildMessages(post: PostDetails): any[] {
    const messages: any[] = [];
    const text = (post.message || '').slice(0, this.maxLength());
    if (text.trim()) {
      messages.push({ type: 'text', text });
    }
    for (const media of post.media || []) {
      if (media.type === 'video') {
        // previewImageUrl is required for video; fall back to the content URL.
        messages.push({
          type: 'video',
          originalContentUrl: media.path,
          previewImageUrl: media.thumbnail || media.path,
        });
      } else {
        messages.push({
          type: 'image',
          originalContentUrl: media.path,
          previewImageUrl: media.thumbnail || media.path,
        });
      }
    }
    return messages;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const token = this.resolveToken(accessToken, clientInformation);
    const messages = this.buildMessages(firstPost);
    if (!messages.length) {
      throw new Error('LINE post has no text and no media to send');
    }

    // The broadcast endpoint accepts at most 5 message objects per call
    // (Messaging API reference) — chunk the message list and send sequentially.
    // Broadcasts return 200 with an empty object (no platform message id), so
    // the X-Line-Retry-Key we generated doubles as the delivery reference.
    const retryKeys: string[] = [];
    for (let i = 0; i < messages.length; i += 5) {
      const retryKey = randomUUID();
      await this.fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({ messages: messages.slice(i, i + 5) }),
      }, this.identifier);
      retryKeys.push(retryKey);
    }

    return [
      {
        id: firstPost.id,
        // Honest sentinel: LINE returns no message id for broadcasts, so we
        // record the retry key(s) of the sent request(s) instead.
        postId: retryKeys.join(','),
        // Broadcasts have no public permalink; point at the Official Account
        // Manager where the sent message is visible.
        releaseURL: 'https://manager.line.biz/',
        status: 'completed',
      },
    ];
  }

  // Channel-level analytics: number of friends (followers) of the Official
  // Account. The insight endpoint is calculated with about a day's delay, so
  // yesterday is the freshest date reliably "ready".
  async analytics(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    const token = this.resolveToken(accessToken, clientInformation);
    const day = dayjs().subtract(1, 'day');
    try {
      const insight = await (
        await this.fetch(
          `https://api.line.me/v2/bot/insight/followers?date=${day.format('YYYYMMDD')}`,
          { headers: { Authorization: `Bearer ${token}` } },
          this.identifier
        )
      ).json();

      if (insight?.status !== 'ready' || insight.followers === null || insight.followers === undefined) {
        return [];
      }

      return [
        {
          label: 'Followers',
          data: [{ total: String(insight.followers), date: day.format('YYYY-MM-DD') }],
        },
      ];
    } catch (err) {
      return [];
    }
  }
}

// ---- provider-kernel module ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

const __adapter = new LineProvider();

export const lineSocialModule: __ProviderModule<any, any> = {
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
