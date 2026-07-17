import { createHash, randomBytes } from 'crypto';
import {
  AuthTokenDetails,
  ClientInformation,
  MediaContent,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeOauthState } from '@gitroom/provider-kernel';
import { timer } from '@gitroom/helpers/utils/timer';
import { SocialAbstract } from '@gitroom/provider-kernel';
import { WhopDto } from '@gitroom/provider-kernel';
import { Integration } from '@prisma/client';
import { Tool } from '@gitroom/provider-kernel';
import { safeFetch } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class WhopProvider extends SocialAbstract implements SocialProvider {
  identifier = 'whop';
  name = 'Whop';
  isBetweenSteps = false;
  scopes = ['openid', 'profile', 'email', 'forum:post:create', 'forum:read', 'company:basic:read'];
  refreshCron = false;
  editor = 'markdown' as const;
  dto = WhopDto;
  toolTip = 'Schedule posts to forums';

  maxLength() {
    return 50000;
  }

  private generateCodeChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body'; value: string }
    | undefined {
    if (body.includes('invalid_grant')) {
      return {
        type: 'refresh-token' as const,
        value: 'Invalid token, please re-authenticate',
      };
    }

    if (body.includes('insufficient_scope')) {
      return {
        type: 'refresh-token' as const,
        value:
          'Insufficient permissions, please re-authenticate with required scopes',
      };
    }

    if (body.includes('invalid_request')) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid request parameters',
      };
    }

    if (body.includes('not_found')) {
      return {
        type: 'bad-body' as const,
        value: 'Forum or experience not found',
      };
    }

    return undefined;
  }

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const response = await (
      await this.fetch('https://api.whop.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientInformation?.client_id || '',
        }),
      })
    ).json();

    const userInfo = await (
      await this.fetch('https://api.whop.com/oauth/userinfo', {
        headers: { Authorization: `Bearer ${response.access_token}` },
      })
    ).json();

    return {
      id: userInfo.sub,
      name: userInfo.name || userInfo.preferred_username || '',
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in || 3600,
      picture: userInfo.picture || '',
      username: userInfo.preferred_username || '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const nonce = makeOauthState();

    return {
      url:
        'https://api.whop.com/oauth/authorize' +
        `?response_type=code` +
        `&client_id=${clientInformation?.client_id || ''}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/whop`
        )}` +
        `&scope=${encodeURIComponent(this.scopes.join(' '))}` +
        `&state=${state}` +
        `&nonce=${nonce}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`,
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
    const redirectUri = `${process.env.FRONTEND_URL}/integrations/social/whop${
      params.refresh ? `?refresh=${params.refresh}` : ''
    }`;

    const tokenResponse = await (
      await this.fetch('https://api.whop.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: redirectUri,
          client_id: clientInformation?.client_id || '',
          code_verifier: params.codeVerifier,
        }),
      })
    ).json();

    if (tokenResponse.error) {
      return `Authentication failed: ${
        tokenResponse.error_description || tokenResponse.error
      }`;
    }

    const userInfo = await (
      await this.fetch('https://api.whop.com/oauth/userinfo', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      })
    ).json();

    return {
      id: userInfo.sub,
      name: userInfo.name || userInfo.preferred_username || '',
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresIn: tokenResponse.expires_in || 3600,
      picture: userInfo.picture || '',
      username: userInfo.preferred_username || '',
    };
  }

  @Tool({ description: 'Companies', dataSchema: [] })
  async companies(accessToken: string, params: any, id: string) {
    try {
      const response = await this.fetch(
        'https://api.whop.com/api/v1/companies?first=50',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        'whop companies'
      );

      const { data } = await response.json();

      return (data || []).map((company: any) => ({
        id: company.id,
        name: company.title,
      }));
    } catch {
      return [];
    }
  }

  @Tool({ description: 'Experiences', dataSchema: [] })
  async experiences(accessToken: string, params: any, id: string) {
    try {
      if (!params?.id) return [];

      const response = await this.fetch(
        `https://api.whop.com/api/v1/forums?company_id=${params.id}&first=50`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        'whop experiences'
      );

      const { data } = await response.json();

      return (data || []).map((forum: any) => ({
        id: forum.experience?.id || forum.id,
        name: forum.experience?.name || forum.id,
      }));
    } catch {
      return [];
    }
  }

  private async uploadMediaToWhop(
    media: MediaContent[],
    accessToken: string
  ): Promise<{ id: string }[]> {
    if (!media || media.length === 0) return [];

    const attachments: { id: string }[] = [];

    for (const item of media) {
      const fileResponse = await safeFetch(item.path);
      const fileBuffer = await fileResponse.arrayBuffer();
      const fileName = item.path.split('/').pop() || 'file';

      const createFileResponse = await (
        await this.fetch(
          'https://api.whop.com/api/v1/files',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: fileName,
            }),
          },
          'create file record'
        )
      ).json();

      if (createFileResponse.upload_url) {
        // The upload URL is provider-returned (a presigned storage URL) — treat
        // it as a user-influenced URL and route through safeFetch, which enforces
        // isSafePublicHttpsUrl + per-hop re-validation before PUTing file bytes.
        await safeFetch(createFileResponse.upload_url, {
          method: 'PUT',
          headers: createFileResponse.upload_headers || {},
          body: fileBuffer,
        });

        // Cap upload-status polling so a stuck upload cannot spin forever
        // (POSTS-06). 120 attempts × 5 s ≈ 10 min, plus a hard 10 min deadline.
        const maxAttempts = 120;
        const deadlineMs = 10 * 60 * 1000;
        const startTime = Date.now();
        let attempts = 0;
        let uploadStatus = 'pending';

        while (uploadStatus !== 'ready') {
          attempts += 1;
          if (attempts > maxAttempts) {
            throw new Error(
              `Whop file upload status polling exceeded ${maxAttempts} attempts`
            );
          }
          if (Date.now() - startTime > deadlineMs) {
            throw new Error(
              'Whop file upload status polling exceeded the 10 minute deadline'
            );
          }

          const fileStatus = await (
            await this.fetch(
              `https://api.whop.com/api/v1/files/${createFileResponse.id}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
              'check file status',
              0,
              true
            )
          ).json();
          uploadStatus = fileStatus.upload_status;
          if (uploadStatus === 'failed') {
            throw new Error('File upload failed');
          }
          if (uploadStatus !== 'ready') {
            await timer(5000);
          }
        }
      }

      attachments.push({ id: createFileResponse.id });
    }

    return attachments;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<WhopDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [post] = postDetails;

    const attachments = await this.uploadMediaToWhop(
      post.media || [],
      accessToken
    );

    const data = await (
      await this.fetch(
        'https://api.whop.com/api/v1/forum_posts',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            experience_id: post.settings.experience,
            content: post.message,
            ...(post.settings.title ? { title: post.settings.title } : {}),
            ...(attachments.length ? { attachments } : {}),
          }),
        },
        'create forum post'
      )
    ).json();

    return [
      {
        id: post.id,
        postId: data.id,
        releaseURL: `https://whop.com/experiences/${post.settings.experience}/${data.id}`,
        status: 'success',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<WhopDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [post] = postDetails;
    const replyToId = lastCommentId || postId;

    const attachments = await this.uploadMediaToWhop(
      post.media || [],
      accessToken
    );

    const data = await (
      await this.fetch(
        'https://api.whop.com/api/v1/forum_posts',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            experience_id: post.settings.experience,
            content: post.message,
            parent_id: replyToId,
            ...(attachments.length ? { attachments } : {}),
          }),
        },
        'create comment'
      )
    ).json();

    return [
      {
        id: post.id,
        postId: data.id,
        releaseURL: `https://whop.com/experiences/${post.settings.experience}/${postId}`,
        status: 'success',
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

const __adapter = new WhopProvider();

export const whopSocialModule: __ProviderModule<any, any> = {
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
