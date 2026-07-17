import {
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { safeFetch, SocialAbstract } from '@gitroom/provider-kernel';
import { createHash, randomBytes } from 'crypto';
import mime from 'mime-types';
import { Integration } from '@prisma/client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

import { metadata as providerMetadata } from './metadata';
export class VkProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2; // VK has moderate API limits
  identifier = 'vk';
  name = 'VK';
  isBetweenSteps = false;
  scopes = [
    'vkid.personal_info',
    'email',
    'wall',
    'status',
    'docs',
    'photos',
    'video',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 2048;
  }

  private _buildRedirectUri(pathSuffix: string): string {
    const frontendUrl = process.env.FRONTEND_URL || '';
    if (!frontendUrl) {
      throw new Error(
        `FRONTEND_URL is not configured (provider: ${this.identifier})`
      );
    }
    if (!frontendUrl.toLowerCase().startsWith('https://')) {
      throw new Error(
        `FRONTEND_URL must use HTTPS for OAuth redirects (provider: ${this.identifier})`
      );
    }
    const redirectUri = `${frontendUrl.replace(/\/+$/, '')}${pathSuffix}`;
    if (!this._isAllowedReturnUrl(redirectUri)) {
      throw new Error(
        `OAuth redirect URI ${redirectUri} is not allowed for provider ${this.identifier}. Add the origin to INTEGRATION_RETURN_URL_ALLOWLIST or set a secure FRONTEND_URL.`
      );
    }
    return redirectUri;
  }

  private _isAllowedReturnUrl(url: string): boolean {
    if (!url || typeof url !== 'string' || !url.toLowerCase().startsWith('https://')) {
      return false;
    }
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        return false;
      }
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname.endsWith('.lan') ||
        /^10\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^169\.254\./.test(hostname)
      ) {
        return false;
      }
      const origin = parsed.origin.toLowerCase().replace(/\/+$/, '');
      const allowlist = (process.env.INTEGRATION_RETURN_URL_ALLOWLIST || '')
        .split(',')
        .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
        .filter(Boolean);
      if (allowlist.includes(origin)) {
        return true;
      }
      const frontendOrigin = (process.env.FRONTEND_URL || '')
        .replace(/\/+$/, '')
        .toLowerCase();
      return origin === frontendOrigin;
    } catch {
      return false;
    }
  }

  async refreshToken(refresh: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const [oldRefreshToken, device_id] = refresh.split('&&&&');
    const clientId = clientInformation?.client_id || '';
    const formData = new FormData();
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', oldRefreshToken);
    formData.append('client_id', clientId);
    formData.append('device_id', device_id);
    formData.append('state', makeId(32));
    formData.append('scope', this.scopes.join(' '));

    const { access_token, refresh_token, expires_in } = await (
      await this.fetch('https://id.vk.com/oauth2/auth', {
        method: 'POST',
        body: formData,
      })
    ).json();

    const newFormData = new FormData();
    newFormData.append('client_id', clientId);
    newFormData.append('access_token', access_token);

    const {
      user: { user_id, first_name, last_name, avatar },
    } = await (
      await this.fetch('https://id.vk.com/oauth2/user_info', {
        method: 'POST',
        body: newFormData,
      })
    ).json();

    return {
      id: user_id,
      name: first_name + ' ' + last_name,
      accessToken: access_token,
      refreshToken: refresh_token + '&&&&' + device_id,
      expiresIn: dayjs().add(expires_in, 'seconds').unix() - dayjs().unix(),
      picture: avatar || '',
      username: first_name.toLowerCase(),
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeId(32);
    const codeVerifier = randomBytes(64).toString('base64url');
    const challenge = Buffer.from(
      createHash('sha256').update(codeVerifier).digest()
    )
      .toString('base64')
      .replace(/=*$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return {
      url:
        'https://id.vk.com/authorize' +
        `?response_type=code` +
        `&client_id=${clientInformation?.client_id || ''}` +
        `&code_challenge_method=S256` +
        `&code_challenge=${challenge}` +
        `&redirect_uri=${encodeURIComponent(
          this._buildRedirectUri('/integrations/social/vk')
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(' '))}`,
      codeVerifier,
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }, clientInformation?: ClientInformation) {
    const [code, device_id] = params.code.split('&&&&');
    const clientId = clientInformation?.client_id || '';

    const formData = new FormData();
    formData.append('client_id', clientId);
    formData.append('grant_type', 'authorization_code');
    formData.append('code_verifier', params.codeVerifier);
    formData.append('device_id', device_id);
    formData.append('code', code);
    formData.append(
      'redirect_uri',
      this._buildRedirectUri('/integrations/social/vk')
    );

    const { access_token, scope, refresh_token, expires_in } = await (
      await this.fetch('https://id.vk.com/oauth2/auth', {
        method: 'POST',
        body: formData,
      })
    ).json();

    const newFormData = new FormData();
    newFormData.append('client_id', clientId);
    newFormData.append('access_token', access_token);

    const {
      user: { user_id, first_name, last_name, avatar },
    } = await (
      await this.fetch('https://id.vk.com/oauth2/user_info', {
        method: 'POST',
        body: newFormData,
      })
    ).json();

    return {
      id: user_id,
      name: first_name + ' ' + last_name,
      accessToken: access_token,
      refreshToken: refresh_token + '&&&&' + device_id,
      expiresIn: dayjs().add(expires_in, 'seconds').unix() - dayjs().unix(),
      picture: avatar || '',
      username: first_name.toLowerCase(),
    };
  }

  private async uploadMedia(
    userId: string,
    accessToken: string,
    post: PostDetails
  ): Promise<{ id: string; type: string }[]> {
    return await Promise.all(
      (post?.media || []).map(async (media) => {
        const all = await (
          await this.fetch(
            hasExtension(media.path, 'mp4')
              ? `https://api.vk.com/method/video.save?access_token=${accessToken}&v=5.251`
              : `https://api.vk.com/method/photos.getWallUploadServer?owner_id=${userId}&access_token=${accessToken}&v=5.251`
          )
        ).json();

        const mediaResponse = await safeFetch(media.path!);
        if (!mediaResponse.ok) {
          throw new Error(
            `Failed to download media for VK upload (status ${mediaResponse.status})`
          );
        }
        const arrayBuffer = await mediaResponse.arrayBuffer();

        const slash = media.path.split('/').at(-1);

        const blob = new Blob([arrayBuffer], {
          type: mime.lookup(slash!) || 'application/octet-stream',
        });

        const formData = new FormData();
        formData.append('photo', blob, slash);
        const value = await (
          await this.fetch(all.response.upload_url, {
            method: 'POST',
            body: formData,
          })
        ).json();

        if (hasExtension(media.path, 'mp4')) {
          return {
            id: all.response.video_id,
            type: 'video',
          };
        }

        const formSend = new FormData();
        formSend.append('photo', value.photo);
        formSend.append('server', value.server);
        formSend.append('hash', value.hash);

        const { id } = (
          await (
            await this.fetch(
              `https://api.vk.com/method/photos.saveWallPhoto?access_token=${accessToken}&v=5.251`,
              {
                method: 'POST',
                body: formSend,
              }
            )
          ).json()
        ).response[0];

        return {
          id,
          type: 'photo',
        };
      })
    );
  }

  async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration?: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const clientId = clientInformation?.client_id || '';

    // Upload media for the first post
    const mediaList = await this.uploadMedia(userId, accessToken, firstPost);

    const body = new FormData();
    body.append('message', firstPost.message);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/wall.post?v=5.251&access_token=${accessToken}&client_id=${clientId}`,
        {
          method: 'POST',
          body,
        }
      )
    ).json();

    return [
      {
        id: firstPost.id,
        postId: String(response?.post_id),
        releaseURL: `https://vk.com/feed?w=wall${userId}_${response?.post_id}`,
        status: 'completed',
      },
    ];
  }

  async comment(
    userId: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const clientId = clientInformation?.client_id || '';

    // Upload media for the comment
    const mediaList = await this.uploadMedia(userId, accessToken, commentPost);

    const body = new FormData();
    body.append('message', commentPost.message);
    body.append('post_id', postId);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/wall.createComment?v=5.251&access_token=${accessToken}&client_id=${clientId}`,
        {
          method: 'POST',
          body,
        }
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: String(response?.comment_id),
        releaseURL: `https://vk.com/feed?w=wall${userId}_${postId}`,
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

const __adapter = new VkProvider();

export const vkSocialModule: __ProviderModule<any, any> = {
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
