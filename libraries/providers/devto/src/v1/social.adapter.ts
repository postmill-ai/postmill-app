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
import { DevToSettingsDto } from '@gitroom/provider-kernel';
import { Tool } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class DevToProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Dev.to has moderate publishing limits
  identifier = 'devto';
  name = 'Dev.to';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = [] as string[];
  maxLength() {
    return 100000;
  }
  dto = DevToSettingsDto;

  async generateAuthUrl() {
    const state = makeOauthState();
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  override handleErrors(body: string) {
    if (body.indexOf('Canonical url has already been taken') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Canonical URL already exists',
      };
    }

    return undefined;
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
    return { read: true, reply: true, like: true };
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      let url = `https://dev.to/api/comments?a_id=${postId}`;
      if (cursor) {
        url += `&page=${cursor}`;
      }

      const response = await this.fetch(url, {
        headers: {
          'api-key': accessToken,
        },
      });
      const data = await response.json() as any[];

      const comments: SocialCommentDTO[] = (data || []).map((c: any) => ({
        platformCommentId: String(c.id_code),
        parentPlatformCommentId: c.parent_id ? String(c.parent_id) : undefined,
        author: {
          id: String(c.user?.user_id || c.user?.username || ''),
          name: c.user?.name || '',
          username: c.user?.username,
          picture: c.user?.profile_image,
        },
        content: c.body_html || c.body_text || '',
        createdAt: c.created_at,
        likeCount: c.reactions?.sum || 0,
        raw: c,
      }));

      const nextCursor = data?.length === 100 ? String((parseInt(cursor || '1', 10)) + 1) : undefined;
      return { comments, nextCursor };
    } catch (err) {
      return { comments: [] };
    }
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration
  ): Promise<SocialCommentDTO> {
    try {
      const response = await this.fetch('https://dev.to/api/comments', {
        method: 'POST',
        headers: {
          'api-key': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment: {
            body_markdown: message,
            commentable_id: parseInt(postId, 10),
            commentable_type: 'Article',
            parent_id: parseInt(parentCommentId, 10),
          },
        }),
      });
      const data = await response.json() as any;

      return {
        platformCommentId: String(data.id_code),
        parentPlatformCommentId: parentCommentId,
        author: {
          id: integration.internalId,
          name: integration.name,
          username: integration.profile,
          picture: integration.picture,
        },
        content: message,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        platformCommentId: '',
        parentPlatformCommentId: parentCommentId,
        author: { id: integration?.internalId || '', name: integration?.name || '' },
        content: message,
        createdAt: new Date().toISOString(),
      };
    }
  }

  async likeComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    like: boolean,
    integration: Integration
  ): Promise<{ liked: boolean; likeCount?: number }> {
    try {
      if (like) {
        await this.fetch(`https://dev.to/api/reactions?reactable_type=comment&reactable_id=${commentId}`, {
          method: 'POST',
          headers: {
            'api-key': accessToken,
          },
        });
      }
      return { liked: like };
    } catch (err) {
      return { liked: like };
    }
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
      const { name, id, profile_image, username } = await (
        await this.fetch('https://dev.to/api/users/me', {
          headers: {
            'api-key': body.apiKey,
          },
        })
      ).json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.apiKey,
        id,
        name,
        picture: profile_image || '',
        username,
      };
    } catch (err) {
      return 'Invalid credentials';
    }
  }

  @Tool({ description: 'Tag list', dataSchema: [] })
  async tags(token: string) {
    const tags = await (
      await this.fetch('https://dev.to/api/tags?per_page=1000&page=1', {
        headers: {
          'api-key': token,
        },
      })
    ).json();

    return tags.map((p: any) => ({ value: p.id, label: p.name }));
  }

  @Tool({ description: 'Organization list', dataSchema: [] })
  async organizations(token: string) {
    const orgs = await (
      await this.fetch('https://dev.to/api/articles/me/all?per_page=1000', {
        headers: {
          'api-key': token,
        },
      })
    ).json();

    const allOrgs: string[] = [
      ...new Set(
        orgs
          .flatMap((org: any) => org?.organization?.username)
          .filter((f: string) => f)
      ),
    ] as string[];
    const fullDetails = await Promise.all(
      allOrgs.map(async (org: string) => {
        return (
          await this.fetch(`https://dev.to/api/organizations/${encodeURIComponent(org)}`, {
            headers: {
              'api-key': token,
            },
          })
        ).json();
      })
    );

    return fullDetails.map((org: any) => ({
      id: org.id,
      name: org.name,
      username: org.username,
    }));
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { settings } = postDetails?.[0] || { settings: {} };
    const { id: postId, url } = await (
      await this.fetch(`https://dev.to/api/articles`, {
        method: 'POST',
        body: JSON.stringify({
          article: {
            title: settings.title,
            body_markdown: postDetails?.[0].message,
            published: true,
            ...(settings?.main_image?.path
              ? { main_image: settings?.main_image?.path }
              : {}),
            tags: settings?.tags?.map((t: any) => t.label),
            organization_id: settings.organization,
            ...(settings.canonical
              ? { canonical_url: settings.canonical }
              : {}),
          },
        }),
        headers: {
          'Content-Type': 'application/json',
          'api-key': accessToken,
        },
      })
    ).json();

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: String(postId),
        releaseURL: url,
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

const __adapter = new DevToProvider();

export const devtoSocialModule: __ProviderModule<any, any> = {
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
