import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { RedditSettingsDto } from '@gitroom/provider-kernel';
import { timer } from '@gitroom/helpers/utils/timer';
import { decodeHtmlEntities } from '@gitroom/helpers/utils/html.to.text';
import { groupBy } from 'lodash';
import {
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import { lookup } from 'mime-types';
import { safeFetch } from '@gitroom/provider-kernel';
import WebSocket from 'ws';
import { Logger } from '@nestjs/common';
import { Tool } from '@gitroom/provider-kernel';
import { Integration } from '@prisma/client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';


import { metadata as providerMetadata } from './metadata';
// @ts-ignore
if (!global.WebSocket) global.WebSocket = WebSocket;

export class RedditProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(RedditProvider.name);
  override maxConcurrentJob = 1; // Reddit has strict rate limits (1 request per second)
  identifier = 'reddit';
  name = 'Reddit';
  isBetweenSteps = false;
  scopes = ['read', 'identity', 'submit', 'flair'];
  editor = 'normal' as const;
  dto = RedditSettingsDto;

  maxLength() {
    return 10000;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (
      settings?.subreddit?.some(
        (p: any) => p?.value?.type === 'media' && posts?.[0]?.length !== 1
      )
    ) {
      return 'When posting a media post, you must attached exactly one media file.';
    }

    if (
      posts?.some((p) =>
        p?.some((a) => !a?.thumbnail && (a?.path?.indexOf?.('mp4') ?? -1) > -1)
      )
    ) {
      return 'You must attach a thumbnail to your video post.';
    }

    return true;
  }

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const { access_token: accessToken, expires_in: expiresIn } = await (
      await this.fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${clientInformation?.client_id || ''}:${clientInformation?.client_secret || ''}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      })
    ).json();

    const { name, id, icon_img } = await (
      await this.fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return {
      id,
      name,
      accessToken,
      refreshToken: refreshToken,
      expiresIn,
      picture: icon_img?.split?.('?')?.[0] || '',
      username: name,
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const codeVerifier = makeId(30);
    const url = `https://www.reddit.com/api/v1/authorize?client_id=${
      clientInformation?.client_id || ''
    }&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(
      `${process.env.FRONTEND_URL}/integrations/social/reddit`
    )}&duration=permanent&scope=${encodeURIComponent(this.scopes.join(' '))}`;
    return {
      url,
      codeVerifier,
      state,
    };
  }

  async authenticate(
    params: { code: string; codeVerifier: string },
    clientInformation?: ClientInformation
  ) {
    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      scope,
    } = await (
      await this.fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${clientInformation?.client_id || ''}:${clientInformation?.client_secret || ''}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/reddit`,
        }),
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const { name, id, icon_img } = await (
      await this.fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return {
      id,
      name,
      accessToken,
      refreshToken,
      expiresIn,
      picture: icon_img?.split?.('?')?.[0] || '',
      username: name,
    };
  }

  private async uploadFileToReddit(accessToken: string, path: string) {
    const mimeType = lookup(path);
    const formData = new FormData();
    formData.append('filepath', path.split('/').pop());
    formData.append('mimetype', mimeType || 'application/octet-stream');

    const {
      args: { action, fields },
    } = await (
      await this.fetch(
        'https://oauth.reddit.com/api/media/asset',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        },
        'reddit',
        0,
        true
      )
    ).json();

    const mediaResponse = await safeFetch(path);
    const data = Buffer.from(await mediaResponse.arrayBuffer());

    const upload = (fields as { name: string; value: string }[]).reduce(
      (acc, value) => {
        acc.append(value.name, value.value);
        return acc;
      },
      new FormData()
    );

    upload.append('file', new Blob([data], { type: mimeType as string }));

    const d = await safeFetch('https:' + action, {
      method: 'POST',
      body: upload,
    });

    const match = [...(await d.text()).matchAll(/<Location>(.*?)<\/Location>/g)];
    if (!match?.[0]?.[1]) {
      throw new RefreshToken('reddit', 'No location header found in upload response', {} as BodyInit);
    }
    return match[0][1];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<RedditSettingsDto>[]
  ): Promise<PostResponse[]> {
    const [post] = postDetails;

    const valueArray: PostResponse[] = [];
    for (const firstPostSettings of post.settings.subreddit) {
      const kind =
        firstPostSettings.value.type === 'media'
          ? hasExtension(post?.media?.[0]?.path, 'mp4')
            ? 'video'
            : 'image'
          : firstPostSettings.value.type;
      const postData = {
        api_type: 'json',
        title: firstPostSettings.value.title || '',
        kind:
          ['link', 'self', 'image', 'video', 'videogif'].indexOf(kind) > -1
            ? kind
            : 'self',
        ...(firstPostSettings.value.flair
          ? { flair_id: firstPostSettings.value.flair.id }
          : {}),
        ...(firstPostSettings.value.type === 'link'
          ? {
              url: firstPostSettings.value.url,
            }
          : {}),
        ...(firstPostSettings.value.type === 'media'
          ? {
              url: await this.uploadFileToReddit(
                accessToken,
                post?.media?.[0]?.path
              ),
              ...(hasExtension(post?.media?.[0]?.path, 'mp4')
                ? {
                    video_poster_url: await this.uploadFileToReddit(
                      accessToken,
                      post?.media?.[0]?.thumbnail
                    ),
                  }
                : {}),
            }
          : {}),
        text: post.message,
        sr: firstPostSettings.value.subreddit.replace('/r/', '').toLowerCase(),
      };

      const all = await (
        await this.fetch('https://oauth.reddit.com/api/submit', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(postData),
        })
      ).json();

      const {
        id: redditId,
        name,
        url,
      } = await new Promise<{
        id: string;
        name: string;
        url: string;
      }>((res) => {
        if (all?.json?.data?.id) {
          res(all.json.data);
        }

        const ws = new WebSocket(all.json.data.websocket_url);
        ws.on('message', (data: any) => {
          setTimeout(() => {
            res({ id: '', name: '', url: '' });
            ws.close();
          }, 30_000);
          try {
            const parsedData = JSON.parse(data.toString());
            if (parsedData?.payload?.redirect) {
              const onlyId = parsedData?.payload?.redirect.replace(
                /https:\/\/www\.reddit\.com\/r\/.*?\/comments\/(.*?)\/.*/g,
                '$1'
              );
              res({
                id: onlyId,
                name: `t3_${onlyId}`,
                url: parsedData?.payload?.redirect,
              });
            }
          } catch (err) {}
        });
      });

      valueArray.push({
        postId: redditId,
        releaseURL: url,
        id: post.id,
        status: 'published',
      });

      if (post.settings.subreddit.length > 1) {
        await timer(5000);
      }
    }

    return Object.values(groupBy(valueArray, (p) => p.id)).map((p) => ({
      id: p[0].id,
      postId: p.map((p) => p.postId).join(','),
      releaseURL: p.map((p) => p.releaseURL).join(','),
      status: 'published',
    }));
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<RedditSettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;

    // Reddit uses thing_id format like t3_xxx for posts
    const thingId = postId.startsWith('t3_') ? postId : `t3_${postId}`;

    const {
      json: {
        data: {
          things: [
            {
              data: { id: commentId, permalink },
            },
          ],
        },
      },
    } = await (
      await this.fetch('https://oauth.reddit.com/api/comment', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          text: commentPost.message,
          thing_id: thingId,
          api_type: 'json',
        }),
      })
    ).json();

    return [
      {
        postId: commentId,
        releaseURL: 'https://www.reddit.com' + permalink,
        id: commentPost.id,
        status: 'published',
      },
    ];
  }

  @Tool({
    description: 'Get list of subreddits with information',
    dataSchema: [
      {
        key: 'word',
        type: 'string',
        description: 'Search subreddit by string',
      },
    ],
  })
  async subreddits(accessToken: string, data: any) {
    const {
      data: { children },
    } = await (
      await this.fetch(
        `https://oauth.reddit.com/subreddits/search?show=public&q=${data.word}&sort=activity&show_users=false&limit=10`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'reddit',
        0,
        false
      )
    ).json();

    return children
      .filter(
        ({ data }: { data: any }) =>
          data.subreddit_type === 'public' && data.submission_type !== 'image'
      )
      .map(({ data: { title, url, id } }: any) => ({
        title,
        name: url,
        id,
      }));
  }

  private getPermissions(submissionType: string, allow_images: string) {
    const permissions = [];
    if (['any', 'self'].indexOf(submissionType) > -1) {
      permissions.push('self');
    }

    if (['any', 'link'].indexOf(submissionType) > -1) {
      permissions.push('link');
    }

    if (allow_images) {
      permissions.push('media');
    }

    return permissions;
  }

  @Tool({
    description: 'Get list of flairs and restrictions for a subreddit',
    dataSchema: [
      {
        key: 'subreddit',
        type: 'string',
        description:
          'Search flairs and restrictions by subreddit key should be "/r/[name]"',
      },
    ],
  })
  async restrictions(accessToken: string, data: { subreddit: string }) {
    const {
      data: { submission_type, allow_images, ...all2 },
    } = await (
      await this.fetch(
        `https://oauth.reddit.com/${data.subreddit}/about`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'reddit',
        0,
        false
      )
    ).json();

    const { is_flair_required, ...all } = await (
      await this.fetch(
        `https://oauth.reddit.com/api/v1/${
          data.subreddit.split('/r/')[1]
        }/post_requirements`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'reddit',
        0,
        false
      )
    ).json();

     
    const newData = await new Promise<{ id: string; name: string }[]>(
      async (res) => {
        try {
          const flair = await (
            await this.fetch(
              `https://oauth.reddit.com/${data.subreddit}/api/link_flair_v2`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              },
              'reddit',
              0,
              false
            )
          ).json();

          res(flair);
        } catch (err) {
          return res([]);
        }
      }
    );

    return {
      subreddit: data.subreddit,
      allow: this.getPermissions(submission_type, allow_images),
      is_flair_required: is_flair_required && newData.length > 0,
      flairs:
        newData?.map?.((p: any) => ({
          id: p.id,
          name: p.text,
        })) || [],
    };
  }

  override get commentsCapabilities() {
    return { read: true, reply: true, like: false };
  }

  private flattenRedditComments(children: any[], depth = 0, maxDepth = 10): SocialCommentDTO[] {
    if (depth >= maxDepth) return [];
    const result: SocialCommentDTO[] = [];

    for (const child of children) {
      if (child.kind !== 't1') continue;
      const data = child.data;

      result.push({
        platformCommentId: data.id,
        parentPlatformCommentId: data.parent_id?.startsWith('t1_')
          ? data.parent_id.slice(3)
          : undefined,
        author: {
          id: data.author || '',
          name: data.author || '',
          username: data.author,
          profileUrl: `https://www.reddit.com/user/${data.author}/`,
        },
        content: decodeHtmlEntities(data.body || ''),
        createdAt: new Date(data.created_utc * 1000).toISOString(),
        likeCount: data.score,
        replyCount: data.replies?.data?.children?.length || 0,
        likedByMe: !!data.likes,
        raw: data,
      });

      if (data.replies && typeof data.replies === 'object' && data.replies.data?.children) {
        result.push(...this.flattenRedditComments(data.replies.data.children, depth + 1, maxDepth));
      }
    }

    return result;
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    _integration: Integration
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const cleanPostId = postId.startsWith('t3_') ? postId.slice(3) : postId;

      const info = await (
        await this.fetch(
          `https://oauth.reddit.com/api/info?id=t3_${cleanPostId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
      ).json() as any;

      const subreddit = info?.data?.children?.[0]?.data?.subreddit;
      if (!subreddit) {
        return { comments: [] };
      }

      const afterParam = cursor ? `&after=${cursor}` : '';
      const commentsResponse = await (
        await this.fetch(
          `https://oauth.reddit.com/r/${subreddit}/comments/${cleanPostId}?limit=100${afterParam}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )
      ).json() as any[];

      const commentsListing = commentsResponse?.[1];
      if (!commentsListing?.data?.children) {
        return { comments: [] };
      }

      const after = commentsListing?.data?.after || undefined;
      const comments = this.flattenRedditComments(commentsListing.data.children);

      return { comments, nextCursor: after };
    } catch (err) {
      this.logger.error(
        `Reddit fetchComments error: ${(err as Error)?.message || 'unknown'}`
      );
      return { comments: [] };
    }
  }

  async replyToComment(
    id: string,
    accessToken: string,
    _postId: string,
    parentCommentId: string,
    message: string,
    _integration: Integration
  ) {
    try {
      const thingId = parentCommentId.startsWith('t1_')
        ? parentCommentId
        : `t1_${parentCommentId}`;

      const response = await (
        await this.fetch('https://oauth.reddit.com/api/comment', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            text: message,
            thing_id: thingId,
            api_type: 'json',
          }),
        })
      ).json() as any;

      const commentData = response?.json?.data?.things?.[0]?.data;

      return {
        platformCommentId: commentData?.id || '',
        parentPlatformCommentId: parentCommentId,
        author: {
          id: commentData?.author || '',
          name: commentData?.author || '',
          username: commentData?.author,
          profileUrl: commentData?.author
            ? `https://www.reddit.com/user/${commentData.author}/`
            : undefined,
        },
        content: message,
        createdAt: commentData?.created_utc
          ? new Date(commentData.created_utc * 1000).toISOString()
          : new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        likedByMe: false,
      };
    } catch (err) {
      this.logger.error(
        `Reddit replyToComment error: ${(err as Error)?.message || 'unknown'}`
      );
      return {
        platformCommentId: '',
        parentPlatformCommentId: parentCommentId,
        author: {
          id: '',
          name: '',
          username: '',
        },
        content: message,
        createdAt: new Date().toISOString(),
      };
    }
  }

  // Reddit exposes no per-account channel analytics, so there is no analytics();
  // per-post metrics come from the public /api/info listing (score / upvote
  // ratio / comment count), subreddit-agnostic — same fetch path as fetchComments.
  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      // A multi-subreddit publish stores its `releaseId` comma-joined, so
      // prefix each id with `t3_` (if not already) and re-join for /api/info.
      const ids = postId
        .split(',')
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => (raw.startsWith('t3_') ? raw : `t3_${raw}`))
        .join(',');
      const info = (await (
        await this.fetch(
          `https://oauth.reddit.com/api/info?id=${ids}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
      ).json()) as any;

      const children: any[] = (info?.data?.children ?? [])
        .map((c: any) => c?.data)
        .filter(Boolean);
      if (!children.length) {
        return [];
      }

      // Aggregate across all children: score / comments sum, ratio averages.
      let score = 0;
      let numComments = 0;
      let ratioSum = 0;
      let ratioCount = 0;
      for (const data of children) {
        if (data.score !== undefined && data.score !== null) {
          score += Number(data.score) || 0;
        }
        if (data.num_comments !== undefined && data.num_comments !== null) {
          numComments += Number(data.num_comments) || 0;
        }
        if (data.upvote_ratio !== undefined && data.upvote_ratio !== null) {
          ratioSum += Number(data.upvote_ratio) || 0;
          ratioCount += 1;
        }
      }

      const today = dayjs().format('YYYY-MM-DD');
      const result: AnalyticsData[] = [];
      const push = (label: string, value: unknown) => {
        if (value !== undefined && value !== null) {
          result.push({ label, data: [{ total: String(value), date: today }] });
        }
      };

      push('Score', score);
      push(
        'Upvote Ratio',
        ratioCount ? Math.round((ratioSum / ratioCount) * 10000) / 10000 : undefined
      );
      push('Comments', numComments);

      return result;
    } catch (err) {
      this.logger.warn(`Reddit postAnalytics failed: ${(err as Error)?.message}`);
      return [];
    }
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new RedditProvider();

export const redditSocialModule: __ProviderModule<any, any> = {
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
