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
import { timer } from '@gitroom/helpers/utils/timer';
import { Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/provider-kernel';
import { capitalize, chunk } from 'lodash';
import { Plug } from '@gitroom/helpers/decorators/plug.decorator';
import { Integration } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

import { metadata as providerMetadata } from './metadata';
export class ThreadsProvider extends SocialAbstract implements SocialProvider {
  identifier = 'threads';
  name = 'Threads';
  isBetweenSteps = false;
  scopes = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_replies',
    'threads_manage_insights',
    // 'threads_profile_discovery',
  ];
  override maxConcurrentJob = 2; // Threads has moderate rate limits
  refreshCron = true;

  private readonly logger = new Logger(ThreadsProvider.name);

  override get commentsCapabilities() {
    return { read: true, reply: true, like: false };
  }

  editor = 'normal' as const;
  maxLength() {
    return 500;
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

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('Error validating access token')) {
      return { type: 'refresh-token', value: 'Threads access token expired' };
    }

    if (body.includes('2207051')) {
      return {
        type: 'bad-body',
        value:
          'Error from Meta: We restrict certain activity to protect our community',
      };
    }

    if (body.includes('The media could not be fetched from this URI')) {
      return {
        type: 'bad-body',
        value:
          "One of the media URLs is invalid or inaccessible, make sure it's being uploaded to Postmill first",
      };
    }
    if (body.includes('text must be at most 500 characters')) {
      return {
        type: 'bad-body',
        value: 'Post text exceeds 500 characters limit',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { access_token } = await (
      await this.fetch(
        `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${refresh_token}`
      )
    ).json();

    const { id, name, username, picture } = await this.fetchUserInfo(
      access_token
    );

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: picture || '',
      username: '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    return {
      url:
        'https://www.threads.net/oauth/authorize' +
        `?client_id=${clientInformation?.client_id || ''}` +
        `&redirect_uri=${encodeURIComponent(
          this._buildRedirectUri('/integrations/social/threads')
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: makeId(10),
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
    const getAccessToken = await (
      await this.fetch(
        'https://graph.threads.net/oauth/access_token' +
          `?client_id=${clientInformation?.client_id || ''}` +
          `&redirect_uri=${encodeURIComponent(
            this._buildRedirectUri('/integrations/social/threads')
          )}` +
          `&grant_type=authorization_code` +
          `&client_secret=${clientInformation?.client_secret || ''}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token } = await (
      await this.fetch(
        'https://graph.threads.net/access_token' +
          '?grant_type=th_exchange_token' +
          `&client_secret=${clientInformation?.client_secret || ''}` +
          `&access_token=${getAccessToken.access_token}`
      )
    ).json();

    const { id, name, username, picture } = await this.fetchUserInfo(
      access_token
    );

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: picture || '',
      username: username,
    };
  }

  private readonly maxContainerStatusAttempts = 60;
  private readonly containerStatusDeadlineMs = 10 * 60 * 1000;

  private async checkLoaded(
    mediaContainerId: string,
    accessToken: string
  ): Promise<boolean> {
    const deadline = Date.now() + this.containerStatusDeadlineMs;
    let attempts = 0;

    while (attempts < this.maxContainerStatusAttempts && Date.now() < deadline) {
      const { status, id, error_message } = await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${mediaContainerId}?fields=status,error_message&access_token=${accessToken}`
        )
      ).json();

      if (status === 'ERROR') {
        throw new Error(id);
      }

      if (status === 'FINISHED') {
        await timer(2000);
        return true;
      }

      attempts += 1;

      // Only sleep if we are going to poll again.
      if (attempts < this.maxContainerStatusAttempts && Date.now() < deadline) {
        await timer(2200);
      }
    }

    throw new Error(
      `Threads media container ${mediaContainerId} did not finish processing after ${this.maxContainerStatusAttempts} attempts / ${this.containerStatusDeadlineMs / 60000} minutes`
    );
  }

  private async fetchUserInfo(accessToken: string) {
    const { id, username, threads_profile_picture_url } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name: username,
      picture: threads_profile_picture_url || '',
      username,
    };
  }

  private async createSingleMediaContent(
    userId: string,
    accessToken: string,
    media: { path: string },
    message: string,
    isCarouselItem = false,
    replyToId?: string
  ): Promise<string> {
    const mediaType = hasExtension(media.path, 'mp4')
      ? 'video_url'
      : 'image_url';
    const mediaParams = new URLSearchParams({
      ...(mediaType === 'video_url' ? { video_url: media.path } : {}),
      ...(mediaType === 'image_url' ? { image_url: media.path } : {}),
      ...(isCarouselItem ? { is_carousel_item: 'true' } : {}),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      media_type: mediaType === 'video_url' ? 'VIDEO' : 'IMAGE',
      text: message,
      access_token: accessToken,
    });

    const { id: mediaId } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${userId}/threads?${mediaParams.toString()}`,
        {
          method: 'POST',
        }
      )
    ).json();

    return mediaId;
  }

  private async createCarouselContent(
    userId: string,
    accessToken: string,
    media: { path: string }[],
    message: string,
    replyToId?: string
  ): Promise<string> {
    // Create each media item
    const mediaIds = [];
    for (const mediaItem of media) {
      const mediaId = await this.createSingleMediaContent(
        userId,
        accessToken,
        mediaItem,
        message,
        true
      );
      mediaIds.push(mediaId);
    }

    // Wait for all media to be loaded
    await Promise.all(
      mediaIds.map((id: string) => this.checkLoaded(id, accessToken))
    );

    // Create carousel container
    const params = new URLSearchParams({
      text: message,
      media_type: 'CAROUSEL',
      children: mediaIds.join(','),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      access_token: accessToken,
    });

    const { id: containerId } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${userId}/threads?${params.toString()}`,
        {
          method: 'POST',
        }
      )
    ).json();

    return containerId;
  }

  private async createTextContent(
    userId: string,
    accessToken: string,
    message: string,
    replyToId?: string,
    quoteId?: string
  ): Promise<string> {
    const form = new FormData();
    form.append('media_type', 'TEXT');
    form.append('text', message);
    form.append('access_token', accessToken);

    if (replyToId) {
      form.append('reply_to_id', replyToId);
    }

    if (quoteId) {
      form.append('quote_post_id', quoteId);
    }

    const { id: contentId, ...all } = await (
      await this.fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
        method: 'POST',
        body: form,
      })
    ).json();

    return contentId;
  }

  private async publishThread(
    userId: string,
    accessToken: string,
    creationId: string
  ): Promise<{ threadId: string; permalink: string }> {
    await this.checkLoaded(creationId, accessToken);

    const { id: threadId } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${creationId}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    const { permalink } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${threadId}?fields=id,permalink&access_token=${accessToken}`
      )
    ).json();

    return { threadId, permalink };
  }

  private async createThreadContent(
    userId: string,
    accessToken: string,
    postDetails: PostDetails,
    replyToId?: string,
    quoteId?: string
  ): Promise<string> {
    // Handle content creation based on media type
    if (!postDetails.media || postDetails.media.length === 0) {
      // Text-only content
      return await this.createTextContent(
        userId,
        accessToken,
        postDetails.message,
        replyToId,
        quoteId
      );
    } else if (postDetails.media.length === 1) {
      // Single media content
      return await this.createSingleMediaContent(
        userId,
        accessToken,
        postDetails.media[0],
        postDetails.message,
        false,
        replyToId
      );
    } else {
      // Carousel content
      return await this.createCarouselContent(
        userId,
        accessToken,
        postDetails.media,
        postDetails.message,
        replyToId
      );
    }
  }

  async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails<{
      active_thread_finisher: boolean;
      thread_finisher: string;
    }>[]
  ): Promise<PostResponse[]> {
    if (!postDetails.length) {
      return [];
    }

    const [firstPost] = postDetails;

    // Create the initial thread
    const initialContentId = await this.createThreadContent(
      userId,
      accessToken,
      firstPost
    );

    // Publish the thread
    const { threadId, permalink } = await this.publishThread(
      userId,
      accessToken,
      initialContentId
    );

    // Return the main post response
    return [
      {
        id: firstPost.id,
        postId: threadId,
        status: 'success',
        releaseURL: permalink,
      },
    ];
  }

  async comment(
    userId: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<{
      active_thread_finisher: boolean;
      thread_finisher: string;
    }>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    if (!postDetails.length) {
      return [];
    }

    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    // Create reply content
    const replyContentId = await this.createThreadContent(
      userId,
      accessToken,
      commentPost,
      replyToId
    );

    // Publish the reply
    const { threadId: replyThreadId, permalink } = await this.publishThread(
      userId,
      accessToken,
      replyContentId
    );

    return [
      {
        id: commentPost.id,
        postId: replyThreadId,
        status: 'success',
        releaseURL: permalink,
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${id}/threads_insights?metric=views,likes,replies,reposts,quotes&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    return (
      data?.map((d: any) => ({
        label: capitalize(d.name),
        data: d.total_value
          ? [{ total: d.total_value.value, date: dayjs().format('YYYY-MM-DD') }]
          : d.values.map((v: any) => ({
              total: v.value,
              date: dayjs(v.end_time).format('YYYY-MM-DD'),
            })),
      })) || []
    );
  }

  @Plug({
    identifier: 'threads-autoPlugPost',
    title: 'Auto plug post',
    description:
      'When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
      {
        name: 'post',
        type: 'richtext',
        placeholder: 'Post to plug',
        description: 'Message content to plug',
        validation: /^[\s\S]{3,}$/g,
      },
    ],
  })
  async autoPlugPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string; post: string }
  ) {
    const { data } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${id}/insights?metric=likes&access_token=${integration.token}`
      )
    ).json();

    const {
      values: [value],
    } = data.find((p: any) => p.name === 'likes');

    if (value.value >= fields.likesAmount) {
      await timer(2000);

      const form = new FormData();
      form.append('media_type', 'TEXT');
      form.append('text', stripHtmlValidation('normal', fields.post, true));
      form.append('reply_to_id', id);
      form.append('access_token', integration.token);

      const { id: replyId } = await (
        await this.fetch('https://graph.threads.net/v1.0/me/threads', {
          method: 'POST',
          body: form,
        })
      ).json();

      await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${integration.internalId}/threads_publish?creation_id=${replyId}&access_token=${integration.token}`,
          {
            method: 'POST',
          }
        )
      ).json();
      return true;
    }

    return false;
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch thread insights from Threads API
      const { data } = await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${postId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value ?? metric.total_value?.value;
        if (value === undefined) continue;

        let label = '';

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'replies':
            label = 'Replies';
            break;
          case 'reposts':
            label = 'Reposts';
            break;
          case 'quotes':
            label = 'Quotes';
            break;
        }

        if (label) {
          result.push({
            label,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      this.logger.warn('Error fetching Threads post analytics');
      return [];
    }
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    _integration: Integration
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      let url = `https://graph.threads.net/v1.0/${postId}/replies?access_token=${accessToken}&fields=id,text,username,permalink,timestamp,like_count,replies&limit=50`;

      if (cursor) {
        url += `&after=${cursor}`;
      }

      const { data, paging } = await (
        await this.fetch(url)
      ).json() as any;

      const comments: SocialCommentDTO[] = (data || []).map((reply: any) => ({
        platformCommentId: reply.id,
        author: {
          id: reply.id,
          name: reply.username || '',
          username: reply.username,
        },
        content: reply.text || '',
        createdAt: reply.timestamp || new Date().toISOString(),
        likeCount: reply.like_count,
        replyCount: reply.replies?.data?.length,
        raw: reply,
      }));

      const nextCursor = paging?.cursors?.after || undefined;

      return { comments, nextCursor };
    } catch (err) {
      this.logger.error(
        `Threads fetchComments error: ${(err as Error)?.message || 'unknown'}`
      );
      return { comments: [] };
    }
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    _integration: Integration
  ) {
    try {
      const { id: replyId } = await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${postId}/replies?access_token=${accessToken}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: message,
              reply_to_id: parentCommentId,
            }),
          }
        )
      ).json() as any;

      return {
        platformCommentId: replyId,
        parentPlatformCommentId: parentCommentId,
        author: {
          id,
          name: '',
          username: '',
        },
        content: message,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(
        `Threads replyToComment error: ${(err as Error)?.message || 'unknown'}`
      );
      throw err;
    }
  }

  // override async mention(
  //   token: string,
  //   data: { query: string },
  //   id: string,
  //   integration: Integration
  // ) {
  //   const p = await (
  //     await fetch(
  //       `https://graph.threads.net/v1.0/profile_lookup?username=${data.query}&access_token=${integration.token}`
  //     )
  //   ).json();
  //
  //   return [
  //     {
  //       id: String(p.id),
  //       label: p.name,
  //       image: p.profile_picture_url,
  //     },
  //   ];
  // }
  //
  // mentionFormat(idOrHandle: string, name: string) {
  //   return `@${idOrHandle}`;
  // }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new ThreadsProvider();

export const threadsSocialModule: __ProviderModule<any, any> = {
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
