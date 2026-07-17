import {
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import { InstagramDto } from '@gitroom/provider-kernel';
import { InstagramProvider } from '@gitroom/provider-kernel';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/provider-kernel';
import { Logger } from '@nestjs/common';

import { metadata as providerMetadata } from './metadata';
@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramStandaloneProvider
  extends SocialAbstract
  implements SocialProvider
{
  private _instagramProvider: InstagramProvider | undefined;
  private get instagramProvider(): InstagramProvider {
    if (!this._instagramProvider) {
      this._instagramProvider = new InstagramProvider();
    }
    return this._instagramProvider;
  }
  identifier = 'instagram-standalone';
  name = 'Instagram\n(Standalone)';
  isBetweenSteps = false;
  refreshCron = true;
  scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_insights',
  ];
    override maxConcurrentJob = 200; // Instagram standalone has stricter limits
  dto = InstagramDto;
  private readonly logger = new Logger(InstagramStandaloneProvider.name);

  editor = 'normal' as const;
  maxLength() {
    return 2200;
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

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    if (settings?.is_trial_reel) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    return true;
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return this.instagramProvider.handleErrors(body, status);
  }

  override get commentsCapabilities() {
    return { read: true, reply: true, like: true };
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { access_token } = await (
      await this.fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refresh_token}`
      )
    ).json();

    const {
      user_id,
      name,
      username,
      profile_picture_url = '',
    } = await (
      await this.fetch(
        `https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url&access_token=${access_token}`
      )
    ).json();

    return {
      id: user_id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: profile_picture_url || '',
      username,
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    return {
      url:
        `https://www.instagram.com/oauth/authorize?enable_fb_login=0&client_id=${
          clientInformation?.client_id || ''
        }&redirect_uri=${encodeURIComponent(
          this._buildRedirectUri('/integrations/social/instagram-standalone')
        )}&response_type=code&scope=${encodeURIComponent(
          this.scopes.join(',')
        )}` + `&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh: string;
    },
    clientInformation?: ClientInformation
  ) {
    const formData = new FormData();
    formData.append('client_id', clientInformation?.client_id || '');
    formData.append('client_secret', clientInformation?.client_secret || '');
    formData.append('grant_type', 'authorization_code');
    formData.append(
      'redirect_uri',
      this._buildRedirectUri('/integrations/social/instagram-standalone')
    );
    formData.append('code', params.code);

    const getAccessToken = await (
      await this.fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: formData,
      })
    ).json();

    const { access_token, expires_in, ...all } = await (
      await this.fetch(
        'https://graph.instagram.com/access_token' +
          '?grant_type=ig_exchange_token' +
          `&client_id=${clientInformation?.client_id || ''}` +
          `&client_secret=${clientInformation?.client_secret || ''}` +
          `&access_token=${getAccessToken.access_token}`
      )
    ).json();

    this.checkScopes(this.scopes, getAccessToken.permissions);

    const { user_id, name, username, profile_picture_url } = await (
      await this.fetch(
        `https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url&access_token=${access_token}`
      )
    ).json();

    return {
      id: user_id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: profile_picture_url,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    return this.instagramProvider.post(
      id,
      accessToken,
      postDetails,
      integration,
      clientInformation,
      'graph.instagram.com'
    );
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    return this.instagramProvider.comment(
      id,
      postId,
      lastCommentId,
      accessToken,
      postDetails,
      integration,
      clientInformation,
      'graph.instagram.com'
    );
  }

  async analytics(id: string, accessToken: string, date: number, clientInformation?: ClientInformation) {
    return this.instagramProvider.analytics(
      id,
      accessToken,
      date,
      { ...clientInformation, instanceUrl: 'graph.instagram.com' }
    );
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    clientInformation?: ClientInformation
  ) {
    return this.instagramProvider.postAnalytics(
      integrationId,
      accessToken,
      postId,
      date,
      { ...clientInformation, instanceUrl: 'graph.instagram.com' }
    );
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration
  ) {
    return this.instagramProvider.fetchComments(
      id,
      accessToken,
      postId,
      cursor,
      integration
    );
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration
  ) {
    return this.instagramProvider.replyToComment(
      id,
      accessToken,
      postId,
      parentCommentId,
      message,
      integration
    );
  }

  async likeComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    like: boolean,
    integration: Integration
  ) {
    return this.instagramProvider.likeComment(
      id,
      accessToken,
      postId,
      commentId,
      like,
      integration
    );
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new InstagramStandaloneProvider();

export const instagramstandaloneSocialModule: __ProviderModule<any, any> = {
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
