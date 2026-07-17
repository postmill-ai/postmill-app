import {
  AuthTokenDetails, PostDetails, PostResponse, SocialProvider,
} from '@gitroom/provider-kernel';
import { SocialAbstract, ValidityMedia } from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import { safeFetch } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class PixelfedProvider extends SocialAbstract implements SocialProvider {
  identifier = 'pixelfed';
  name = 'Pixelfed';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 3;
  toolTip = 'Create an access token in your Pixelfed instance settings.';
  maxLength() {
    return 500;
  }

  async customFields() {
    return [
      {
        key: 'instance',
        label: 'Instance URL',
        defaultValue: 'https://pixelfed.social',
        validation: `/^https?:\\/\\/.+/`,
        type: 'text' as const,
      },
      {
        key: 'token',
        label: 'Access Token',
        validation: `/^.{8,}$/`,
        type: 'password' as const,
      },
    ];
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (!firstPost?.length) return 'Pixelfed requires at least one image';
    if (firstPost.length > 10) return 'Pixelfed supports up to 10 images';
    if (firstPost.some((m) => m.path.endsWith('.mp4')))
      return 'Pixelfed supports images only';
    return true;
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return { url: state, codeVerifier: makeId(10), state };
  }

  async authenticate(params: { code: string; codeVerifier: string }) {
    const { instance, token } = JSON.parse(
      Buffer.from(params.code, 'base64').toString()
    );
    const base = instance.replace(/\/$/, '');
    const me = await (
      await this.fetch(`${base}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    if (!me?.id) return 'Invalid Pixelfed token or instance';

    return {
      id: String(me.id),
      name: me.display_name || me.username,
      accessToken: token,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: me.avatar || '',
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
    const { instance, token } = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    return { base: instance.replace(/\/$/, ''), token };
  }

  private async uploadMedia(base: string, token: string, m: { path: string; alt?: string }) {
    const form = new FormData();
    form.append('file', await safeFetch(m.path).then((r) => r.blob()));
    if (m.alt) form.append('description', m.alt);
    const media = await (
      await this.fetch(`${base}/api/v1/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
    ).json();
    return media.id as string;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    const { base, token } = this.creds(integration);

    const mediaIds = await Promise.all(
      (first.media || []).map((m) => this.uploadMedia(base, token, m))
    );

    const res = await (
      await this.fetch(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: first.message, media_ids: mediaIds }),
      })
    ).json();

    return [
      { id: first.id, postId: res.id, releaseURL: res.url, status: 'completed' },
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
    const { base, token } = this.creds(integration);
    const res = await (
      await this.fetch(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: c.message,
          in_reply_to_id: lastCommentId || postId,
        }),
      })
    ).json();
    return [
      { id: c.id, postId: res.id, releaseURL: res.url, status: 'completed' },
    ];
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new PixelfedProvider();

export const pixelfedSocialModule: __ProviderModule<any, any> = {
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
