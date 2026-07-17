import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import { tags } from './hashnode.tags';
import { jsonToGraphQLQuery } from 'json-to-graphql-query';
import { HashnodeSettingsDto } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { Tool } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class HashnodeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Hashnode has lenient publishing limits
  identifier = 'hashnode';
  name = 'Hashnode';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  maxLength() {
    return 10000;
  }
  dto = HashnodeSettingsDto;

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
    return { read: true, reply: true, like: false };
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const query = `
        query GetComments($postId: ID!, $first: Int!, $after: String) {
          post(id: $postId) {
            comments(first: $first, after: $after) {
              edges {
                node {
                  id
                  content {
                    markdown
                    html
                  }
                  author {
                    id
                    name
                    username
                    profilePicture
                  }
                  createdAt
                  totalReactions
                  replyCount
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `;

      const response = await this.fetch('https://gql.hashnode.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken,
        },
        body: JSON.stringify({
          query,
          variables: { postId, first: 50, after: cursor || null },
        }),
      });
      const json = await response.json() as any;
      const edges = json?.data?.post?.comments?.edges || [];

      const comments: SocialCommentDTO[] = edges.map(({ node }: any) => ({
        platformCommentId: node.id,
        author: {
          id: node.author?.id || '',
          name: node.author?.name || '',
          username: node.author?.username,
          picture: node.author?.profilePicture,
        },
        content: node.content?.html || node.content?.markdown || '',
        createdAt: node.createdAt,
        likeCount: node.totalReactions,
        replyCount: node.replyCount,
        raw: node,
      }));

      const pageInfo = json?.data?.post?.comments?.pageInfo;
      const nextCursor = pageInfo?.hasNextPage ? pageInfo.endCursor : undefined;

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
      const mutation = `
        mutation AddComment($input: AddCommentInput!) {
          addComment(input: $input) {
            comment {
              id
              content {
                html
                markdown
              }
              createdAt
            }
          }
        }
      `;

      const response = await this.fetch('https://gql.hashnode.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            input: {
              postId,
              contentMarkdown: message,
              parentId: parentCommentId,
            },
          },
        }),
      });
      const json = await response.json() as any;
      const comment = json?.data?.addComment?.comment;

      return {
        platformCommentId: comment?.id || '',
        parentPlatformCommentId: parentCommentId,
        author: {
          id: integration.internalId,
          name: integration.name,
          username: integration.profile,
          picture: integration.picture,
        },
        content: message,
        createdAt: comment?.createdAt || new Date().toISOString(),
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
        data: {
          me: { name, id, profilePicture, username },
        },
      } = await (
        await this.fetch('https://gql.hashnode.com', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `${body.apiKey}`,
          },
          body: JSON.stringify({
            query: `
                    query {
                      me {
                        name,
                        id,
                        profilePicture
                        username
                      }
                    }
                `,
          }),
        })
      ).json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.apiKey,
        id,
        name,
        picture: profilePicture || '',
        username,
      };
    } catch (err) {
      return 'Invalid credentials';
    }
  }

  async tags() {
    return tags.map((tag) => ({ value: tag.objectID, label: tag.name }));
  }

  @Tool({ description: 'Tags', dataSchema: [] })
  tagsList() {
    return tags;
  }

  @Tool({ description: 'Publications', dataSchema: [] })
  async publications(accessToken: string) {
    const {
      data: {
        me: {
          publications: { edges },
        },
      },
    } = await (
      await this.fetch('https://gql.hashnode.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${accessToken}`,
        },
        body: JSON.stringify({
          query: `
            query {
              me {
                publications (first: 50) {
                  edges{
                    node {
                      id
                      title
                    }
                  }
                }
              }
            }
                `,
        }),
      })
    ).json();

    return edges.map(
      ({ node: { id, title } }: { node: { id: string; title: string } }) => ({
        id,
        name: title,
      })
    );
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { settings } = postDetails?.[0] || { settings: {} };
    const query = jsonToGraphQLQuery(
      {
        mutation: {
          publishPost: {
            __args: {
              input: {
                title: settings.title,
                publicationId: settings.publication,
                ...(settings.canonical
                  ? { originalArticleURL: settings.canonical }
                  : {}),
                contentMarkdown: postDetails?.[0].message,
                tags: settings.tags.map((tag: any) => ({ id: tag.value })),
                ...(settings.subtitle ? { subtitle: settings.subtitle } : {}),
                ...(settings.main_image
                  ? {
                      coverImageOptions: {
                        coverImageURL: `${
                          settings?.main_image?.path?.indexOf('http') === -1
                            ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/${process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY}`
                            : ``
                        }${settings?.main_image?.path}`,
                      },
                    }
                  : {}),
              },
            },
            post: {
              id: true,
              url: true,
            },
          },
        },
      },
      { pretty: true }
    );

    const {
      data: {
        publishPost: {
          post: { id: postId, url },
        },
      },
    } = await (
      await this.fetch('https://gql.hashnode.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${accessToken}`,
        },
        body: JSON.stringify({
          query,
        }),
      })
    ).json();

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: postId,
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

const __adapter = new HashnodeProvider();

export const hashnodeSocialModule: __ProviderModule<any, any> = {
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
