import {
  AuthTokenDetails, PostDetails, PostResponse, SocialProvider,
} from '@gitroom/provider-kernel';
import { SocialAbstract, ValidityMedia } from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import { safeFetch } from '@gitroom/provider-kernel';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// S-13: validate callback instance URL before interpolating it into API calls.
function validatePeerTubeInstance(value: unknown): { ok: true; base: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Invalid instance URL' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'Invalid instance URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Instance URL must use HTTPS' };
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost') {
    return { ok: false, error: 'Invalid hostname' };
  }
  if (net.isIP(hostname)) {
    return { ok: false, error: 'IP addresses are not allowed' };
  }
  const base = url.toString().replace(/\/$/, '');
  return { ok: true, base };
}

function assertPeerTubeBody(body: unknown): { instance: string; username: string; password: string } {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid credentials');
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.instance !== 'string' ||
    typeof record.username !== 'string' ||
    typeof record.password !== 'string' ||
    !record.instance.trim() ||
    !record.username.trim() ||
    !record.password.trim()
  ) {
    throw new Error('Invalid credentials');
  }
  const validation = validatePeerTubeInstance(record.instance);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    instance: validation.base,
    username: record.username,
    password: record.password,
  };
}

function parsePeerTubeCallback(token: string): { instance: string; username: string; password: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid credentials');
  }
  return assertPeerTubeBody(parsed);
}
export class PeerTubeProvider extends SocialAbstract implements SocialProvider {
  identifier = 'peertube';
  name = 'PeerTube';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 2;
  toolTip = 'Enter your PeerTube instance URL and login.';
  maxLength() {
    return 10000;
  }

  async customFields() {
    return [
      {
        key: 'instance',
        label: 'Instance URL',
        defaultValue: 'https://',
        validation: `/^https?:\\/\\/.+/`,
        type: 'text' as const,
      },
      { key: 'username', label: 'Username', validation: `/^.+$/`, type: 'text' as const },
      { key: 'password', label: 'Password', validation: `/^.+$/`, type: 'password' as const },
    ];
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (!firstPost?.length) return 'PeerTube requires a video file';
    if (firstPost.length > 1) return 'PeerTube accepts one video per post';
    if (!firstPost[0].path.endsWith('.mp4')) return 'PeerTube requires an .mp4 video';
    return true;
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return { url: state, codeVerifier: makeId(10), state };
  }

  private async login(base: string, username: string, password: string) {
    const client = await (
      await this.fetch(`${base}/api/v1/oauth-clients/local`)
    ).json();
    const token = await (
      await this.fetch(`${base}/api/v1/users/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          grant_type: 'password',
          username,
          password,
        }).toString(),
      })
    ).json();
    if (!token.access_token) throw new Error('PeerTube login failed');
    return token.access_token as string;
  }

  async authenticate(params: { code: string; codeVerifier: string }) {
    let parsed: { instance: string; username: string; password: string };
    try {
      parsed = parsePeerTubeCallback(params.code);
    } catch (err) {
      return 'Invalid PeerTube credentials';
    }
    const { instance: base, username, password } = parsed;
    const accessToken = await this.login(base, username, password);
    const me = await (
      await this.fetch(`${base}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).json();
    if (!me?.id) return 'Invalid PeerTube credentials';

    return {
      id: String(me.id),
      name: me.account?.displayName || me.username,
      accessToken,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: me.account?.avatar?.path ? `${base}${me.account.avatar.path}` : '',
      username: me.username,
    };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      id: '', name: '', username: '', picture: '',
      accessToken: '', refreshToken: '', expiresIn: 0,
    };
  }

  private creds(integration: Integration) {
    const { instance, username, password } = assertPeerTubeBody(
      JSON.parse(AuthService.fixedDecryption(integration.customInstanceDetails!))
    );
    return { base: instance, username, password };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    if (!first.media?.length) throw new Error('PeerTube requires a video file');
    const { base, username, password } = this.creds(integration);
    const token = await this.login(base, username, password);

    const me = await (
      await this.fetch(`${base}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const channelId =
      me?.videoChannels?.[0]?.id ?? me?.account?.id;
    if (!channelId) throw new Error('No PeerTube channel found');

    const form = new FormData();
    form.append('videofile', await safeFetch(first.media![0].path).then((r) => r.blob()));
    form.append('channelId', String(channelId));
    form.append('name', (first.message || 'Video').slice(0, 120));
    form.append('description', first.message || '');
    form.append('privacy', '1');
    const res = await (
      await this.fetch(`${base}/api/v1/videos/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
    ).json();

    const v = res.video;
    return [
      {
        id: first.id,
        postId: String(v.id),
        releaseURL: `${base}/w/${v.uuid}`,
        status: 'completed',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [c] = postDetails;
    const { base, username, password } = this.creds(integration);
    const token = await this.login(base, username, password);
    const res = await (
      await this.fetch(`${base}/api/v1/videos/${postId}/comment-threads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: c.message }),
      })
    ).json();
    return [
      {
        id: c.id,
        postId: String(res?.comment?.id ?? ''),
        releaseURL: `${base}/w/${postId}`,
        status: 'completed',
      },
    ];
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new PeerTubeProvider();

export const peertubeSocialModule: __ProviderModule<any, any> = {
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
