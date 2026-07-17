import {
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId } from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { KickDto } from '@gitroom/provider-kernel';
import { createHash, randomBytes } from 'crypto';

import { metadata as providerMetadata } from './metadata';
export class KickProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3;
  identifier = 'kick';
  name = 'Kick';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = ['chat:write', 'user:read', 'channel:read'];
  dto = KickDto;

  maxLength() {
    return 500; // Kick chat message max length
  }

  private generatePKCE() {
    const codeVerifier = randomBytes(64).toString('base64url');
    const challenge = Buffer.from(
      createHash('sha256').update(codeVerifier).digest()
    )
      .toString('base64')
      .replace(/=*$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return { codeVerifier, codeChallenge: challenge };
  }

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const response = await this.fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientInformation?.client_id || '',
        client_secret: clientInformation?.client_secret || '',
        refresh_token: refreshToken,
      }),
    });

    const { access_token, refresh_token, expires_in } = await response.json();

    // Get user info
    const userInfo = await this.getUserInfo(access_token);

    return {
      refreshToken: refresh_token,
      expiresIn: expires_in,
      accessToken: access_token,
      id: userInfo.id,
      name: userInfo.name,
      picture: userInfo.picture || '',
      username: userInfo.username,
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeId(32);
    const { codeVerifier, codeChallenge } = this.generatePKCE();

    const redirectUri = `${process.env.FRONTEND_URL}/integrations/social/kick`;

    const url =
      `https://id.kick.com/oauth/authorize` +
      `?response_type=code` +
      `&client_id=${clientInformation?.client_id || ''}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(this.scopes.join(' '))}` +
      `&state=${state}` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`;

    return {
      url,
      codeVerifier,
      state,
    };
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    const redirectUri = `${process.env.FRONTEND_URL}/integrations/social/kick${
      params.refresh ? `?refresh=${params.refresh}` : ''
    }`;

    const tokenResponse = await this.fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientInformation?.client_id || '',
        client_secret: clientInformation?.client_secret || '',
        redirect_uri: redirectUri,
        code: params.code,
        code_verifier: params.codeVerifier,
      }),
    });

    const { access_token, refresh_token, expires_in, scope } =
      await tokenResponse.json();

    this.checkScopes(this.scopes, (scope || '').split(' '));

    // Get user info
    const userInfo = await this.getUserInfo(access_token);

    return {
      id: userInfo.id,
      name: userInfo.name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: userInfo.picture || '',
      username: userInfo.username,
    };
  }

  private async getUserInfo(
    accessToken: string
  ): Promise<{ id: string; name: string; username: string; picture?: string }> {
    // Use token introspect to get basic info, then fetch user details
    // Try to get full user info from the API
    const userResponse = await this.fetch(
      'https://api.kick.com/public/v1/users',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'kick user info'
    );

    const userData = await userResponse.json();
    const user = userData.data?.[0] || userData.data;
    return {
      id: String(user.user_id || user.id),
      name: user.name,
      username: user.name,
      picture: user.profile_picture || '',
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    // Post chat message to Kick
    // Note: Kick chat doesn't support media attachments directly in messages
    const response = await this.fetch('https://api.kick.com/public/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'user',
        content: firstPost.message.substring(0, 500), // Ensure max length
        broadcaster_user_id: parseInt(id, 10),
      }),
    });

    const data = await response.json();

    return [
      {
        id: firstPost.id,
        postId: data.data?.message_id || data.message_id || makeId(10),
        releaseURL: `https://kick.com/${integration.profile || 'channel'}`,
        status: data.data?.is_sent || data.is_sent ? 'posted' : 'error',
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
    const [commentPost] = postDetails;

    // Kick supports reply_to_message_id for replies
    const response = await this.fetch('https://api.kick.com/public/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'user',
        content: commentPost.message.substring(0, 500),
        broadcaster_user_id: parseInt(id, 10),
        reply_to_message_id: lastCommentId || postId,
      }),
    });

    const data = await response.json();

    return [
      {
        id: commentPost.id,
        postId: data.data?.message_id || data.message_id || makeId(10),
        releaseURL: `https://kick.com/${integration.profile || 'channel'}`,
        status: data.data?.is_sent || data.is_sent ? 'posted' : 'error',
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

const __adapter = new KickProvider();

export const kickSocialModule: __ProviderModule<any, any> = {
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
