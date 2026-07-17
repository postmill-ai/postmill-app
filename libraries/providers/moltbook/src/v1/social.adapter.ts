import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';

import { metadata as providerMetadata } from './metadata';
const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';

export class MoltbookProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 100; // Moltbook: 100 requests/minute
  identifier = 'moltbook';
  name = 'Moltbook';
  isBetweenSteps = false;
  scopes = [] as string[];
  isWeb3 = true;
  editor = 'normal' as const;

  maxLength() {
    return 300;
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async registerAgent(name: string, description: string) {
    const response = await this.fetch(
      `${MOLTBOOK_API_BASE}/agents/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      },
      'moltbook-register-agent'
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Registration failed');
    }

    return data.agent;
  }

  async checkAgentStatus(apiKey: string) {
    const response = await this.fetch(
      `${MOLTBOOK_API_BASE}/agents/status`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      'moltbook-agent-status'
    );

    return response.json();
  }

  async getAgentProfile(apiKey: string) {
    const response = await this.fetch(
      `${MOLTBOOK_API_BASE}/agents/me`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      'moltbook-agent-profile'
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to get profile');
    }

    return data.agent;
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const apiKey = params.code;

    const profile = await this.getAgentProfile(apiKey);

    return {
      id: profile.name || profile.id,
      name: profile.display_name || profile.name,
      accessToken: apiKey,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: '',
      username: profile.name,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const postData: {
        submolt: string;
        title: string;
        content?: string;
        url?: string;
      } = {
        submolt: post.settings?.submolt || 'general',
        title: post.message.slice(0, 100),
        content: post.message,
      };

      const response = await this.fetch(
        `${MOLTBOOK_API_BASE}/posts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(postData),
        },
        'moltbook-post'
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create post');
      }

      const postId = data.post.id;
      results.push({
        id: post.id,
        postId: String(postId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const commentData: { content: string; parent_id?: string } = {
        content: post.message,
      };

      if (lastCommentId) {
        commentData.parent_id = lastCommentId;
      }

      const response = await this.fetch(
        `${MOLTBOOK_API_BASE}/posts/${postId}/comments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(commentData),
        },
        'moltbook-comment'
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create comment');
      }

      const commentId = data.comment.id;
      results.push({
        id: post.id,
        postId: String(commentId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new MoltbookProvider();

export const moltbookSocialModule: __ProviderModule<any, any> = {
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
