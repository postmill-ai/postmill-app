import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { MediumSettingsDto } from '@gitroom/provider-kernel';
import { Tool } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class MediumProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Medium has lenient publishing limits
  identifier = 'medium';
  name = 'Medium';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = MediumSettingsDto;
  maxLength() {
    return 100000;
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
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

  override get commentsCapabilities() {
    return { read: false, reply: false, like: false };
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    return { comments: [] };
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration
  ): Promise<SocialCommentDTO> {
    return {
      platformCommentId: '',
      parentPlatformCommentId: parentCommentId,
      author: { id: integration?.internalId || '', name: integration?.name || '' },
      content: message,
      createdAt: new Date().toISOString(),
    };
  }

  async likeComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    like: boolean,
    integration: Integration
  ): Promise<{ liked: boolean; likeCount?: number }> {
    // Platform does not support native comment likes
    return { liked: like };
  }

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'API key',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let body: { apiKey: string };
    try {
      const parsed = JSON.parse(Buffer.from(params.code, 'base64').toString());
      if (!parsed || typeof parsed !== 'object' || typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) {
        throw new Error('Invalid callback');
      }
      body = parsed;
    } catch (err) {
      return 'Invalid credentials';
    }
    try {
      const {
        data: { name, id, imageUrl, username },
      } = await (
        await this.fetch('https://api.medium.com/v1/me', {
          headers: {
            Authorization: `Bearer ${body.apiKey}`,
          },
        })
      ).json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.apiKey,
        id,
        name,
        picture: imageUrl || '',
        username,
      };
    } catch (err) {
      return 'Invalid credentials';
    }
  }

  @Tool({ description: 'List of publications', dataSchema: [] })
  async publications(accessToken: string, _: any, id: string) {
    const { data } = await (
      await this.fetch(`https://api.medium.com/v1/users/${id}/publications`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return data;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { settings } = postDetails?.[0] || { settings: {} };
    const { data } = await (
      await this.fetch(
        settings?.publication
          ? `https://api.medium.com/v1/publications/${settings?.publication}/posts`
          : `https://api.medium.com/v1/users/${id}/posts`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: settings.title,
            contentFormat: 'markdown',
            content: postDetails?.[0].message,
            ...(settings.canonical ? { canonicalUrl: settings.canonical } : {}),
            ...(settings?.tags?.length
              ? { tags: settings?.tags?.map((p: any) => p.value) }
              : {}),
            publishStatus: settings?.publication ? 'draft' : 'public',
          }),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )
    ).json();

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: data.id,
        releaseURL: data.url,
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

const __adapter = new MediumProvider();

export const mediumSocialModule: __ProviderModule<any, any> = {
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
