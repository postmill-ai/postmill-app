import { TweetV2, TwitterApi } from 'twitter-api-v2';
import { createHmac, randomBytes } from 'crypto';
import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { lookup } from 'mime-types';
import sharp from 'sharp';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { SocialAbstract } from '@gitroom/provider-kernel';
import { Plug } from '@gitroom/helpers/decorators/plug.decorator';
import { Integration } from '@prisma/client';
import { timer } from '@gitroom/helpers/utils/timer';
import { PostPlug } from '@gitroom/helpers/decorators/post.plug';
import dayjs from 'dayjs';
import { uniqBy } from 'lodash';
import { Logger } from '@nestjs/common';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { stripLinks as removeLinks } from '@gitroom/helpers/utils/strip.links';
import { XDto } from '@gitroom/provider-kernel';
import { Rules } from '@gitroom/provider-kernel';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { getOrgCredential } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
@Rules(
  `X can have maximum 4 pictures, or maximum one video, it can also be without attachments ${
    process.env.STRIP_LINKS_FROM_X_POSTS
      ? 'do not add links, they will be stripped from the post'
      : ''
  }`
)
export class XProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(XProvider.name);
  identifier = 'x';
  name = 'X';
  isBetweenSteps = false;
  scopes = [] as string[];
  stripLinks = () => !!process.env.STRIP_LINKS_FROM_X_POSTS;
  override maxConcurrentJob = 1; // X has strict rate limits (300 posts per 3 hours)
  toolTip =
    'You will be logged in into your current account, if you would like a different account, change it first on X';

  editor = 'normal' as const;
  dto = XDto;

  maxLength(additionalSettings?: any) {
    // Accepts either the parsed additionalSettings array (from validation) or a
    // plain boolean (legacy callers). "Verified" => premium => higher limit.
    const isTwitterPremium = Array.isArray(additionalSettings)
      ? !!additionalSettings.find((p: any) => p?.title === 'Verified')?.value
      : !!additionalSettings;
    return isTwitterPremium ? 4000 : 280;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.includes('You are not permitted to perform this action')) {
      return {
        type: 'bad-body',
        value:
          'There is a problem posting, please edit your post and check character count and media attachments',
      };
    }
    if (body.includes('Service Unavailable')) {
      return {
        type: 'retry',
        value: 'X is currently unavailable, please try again later',
      };
    }
    if (body.includes('maximum of one cashtag')) {
      return {
        type: 'bad-body',
        value: 'There can be maximum of one cashtag ($SYMBOL) per post',
      };
    }
    if (body.includes('maximum of 4 items')) {
      return {
        type: 'bad-body',
        value: 'There must be a maximum of 4 items per post',
      };
    }
    if (body.includes('Unsupported Authentication')) {
      return {
        type: 'refresh-token',
        value: 'X authentication has expired, please reconnect your account',
      };
    }

    if (body.includes('You are not allowed to create a Tweet')) {
      return {
        type: 'bad-body',
        value: 'You are not allowed to create a post with duplicate content',
      }
    }

    if (body.includes('usage-capped')) {
      return {
        type: 'bad-body',
        value: 'Posting failed - capped reached. Please try again later',
      };
    }

    if (body.includes('user-suspended')) {
      return {
        type: 'bad-body',
        value:
          'Your X account has been suspended, please reconnect with another account',
      };
    }
    if (body.includes('duplicate-rules')) {
      return {
        type: 'bad-body',
        value:
          'You have already posted this post, please wait before posting again',
      };
    }
    if (body.includes('Your account is not permitted to access this feature')) {
      return {
        type: 'bad-body',
        value:
          'X blocked your request',
      };
    }
    if (body.includes('The Tweet contains an invalid URL.')) {
      return {
        type: 'bad-body',
        value: 'The Tweet contains a URL that is not allowed on X',
      };
    }
    if (
      body.includes(
        'This user is not allowed to post a video longer than 2 minutes'
      )
    ) {
      return {
        type: 'bad-body',
        value:
          'The video you are trying to post is longer than 2 minutes, which is not allowed for this account',
      };
    }
    return undefined;
  }

  @Plug({
    identifier: 'x-autoRepostPost',
    title: 'Auto Repost Posts',
    disabled: !!process.env.DISABLE_X_ANALYTICS,
    description:
      'When a post reached a certain number of likes, repost it to increase engagement (1 week old posts)',
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
    ],
  })
  async autoRepostPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string }
  ) {
    // @ts-ignore
    const [accessTokenSplit, accessSecretSplit] = integration.token.split(':');
    const appKey = getOrgCredential(integration.organizationId, 'x', 'clientId') || '';
    const appSecret = getOrgCredential(integration.organizationId, 'x', 'clientSecret') || '';
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });

    if (
      (await client.v2.tweetLikedBy(id)).meta.result_count >=
      +fields.likesAmount
    ) {
      await timer(2000);
      await client.v2.retweet(integration.internalId, id);
      return true;
    }

    return false;
  }

  @PostPlug({
    identifier: 'x-repost-post-users',
    title: 'Add Re-posters',
    description: 'Add accounts to repost your post',
    pickIntegration: ['x'],
    fields: [],
  })
  async repostPostUsers(
    integration: Integration,
    originalIntegration: Integration,
    postId: string,
    information: any
  ) {
    const [accessTokenSplit, accessSecretSplit] = integration.token.split(':');
    const appKey = getOrgCredential(integration.organizationId, 'x', 'clientId') || '';
    const appSecret = getOrgCredential(integration.organizationId, 'x', 'clientSecret') || '';
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });

    const {
      data: { id },
    } = await client.v2.me();

    try {
      await client.v2.retweet(id, postId);
    } catch (err) {
      /** nothing **/
    }
  }

  @Plug({
    identifier: 'x-autoPlugPost',
    title: 'Auto plug post',
    disabled: !!process.env.DISABLE_X_ANALYTICS,
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
    // @ts-ignore
    const [accessTokenSplit, accessSecretSplit] = integration.token.split(':');
    const appKey = getOrgCredential(integration.organizationId, 'x', 'clientId') || '';
    const appSecret = getOrgCredential(integration.organizationId, 'x', 'clientSecret') || '';
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });

    if (
      (await client.v2.tweetLikedBy(id)).meta.result_count >=
      +fields.likesAmount
    ) {
      await timer(2000);

      const plugText = stripHtmlValidation('normal', fields.post, true);
      await client.v2.tweet({
        text: this.stripLinks() ? removeLinks(plugText) : plugText,
        reply: { in_reply_to_tweet_id: id },
      });
      return true;
    }

    return false;
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      id: '',
      name: '',
      accessToken: '',
      refreshToken: '',
      expiresIn: 0,
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const appKey = clientInformation?.client_id || '';
    const appSecret = clientInformation?.client_secret || '';
    const client = new TwitterApi({
      appKey,
      appSecret,
    });
    const { url, oauth_token, oauth_token_secret } =
      await client.generateAuthLink(
        (clientInformation?.instanceUrl || process.env.FRONTEND_URL) +
          `/integrations/social/x`,
        {
          authAccessType: 'write',
          linkMode: 'authenticate',
          forceLogin: false,
        }
      );
    return {
      url,
      codeVerifier: oauth_token + ':' + oauth_token_secret,
      state: oauth_token,
    };
  }

  async authenticate(params: { code: string; codeVerifier: string }, clientInformation?: ClientInformation) {
    const { code, codeVerifier } = params;
    const [oauth_token, oauth_token_secret] = codeVerifier.split(':');

    const appKey = clientInformation?.client_id || '';
    const appSecret = clientInformation?.client_secret || '';
    const startingClient = new TwitterApi({
      appKey,
      appSecret,
      accessToken: oauth_token,
      accessSecret: oauth_token_secret,
    });

    const { accessToken, client, accessSecret } = await startingClient.login(
      code
    );

    const {
      data: { username, verified, profile_image_url, name, id },
    } = await client.v2.me({
      'user.fields': [
        'username',
        'verified',
        'verified_type',
        'profile_image_url',
        'name',
      ],
    });

    return {
      id: String(id),
      accessToken: accessToken + ':' + accessSecret,
      name,
      refreshToken: '',
      expiresIn: 999999999,
      picture: profile_image_url || '',
      username,
      additionalSettings: [
        {
          title: 'Verified',
          description: 'Is this a verified user? (Premium)',
          type: 'checkbox' as const,
          value: verified,
        },
      ],
    };
  }

  private async getClient(accessToken: string, appKey: string, appSecret: string) {
    const [accessTokenSplit, accessSecretSplit] = accessToken.split(':');
    return new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });
  }

  private signOAuth1(
    method: string,
    url: string,
    accessToken: string,
    accessSecret: string,
    appKey: string,
    appSecret: string
  ): string {
    const pct = (s: string) =>
      encodeURIComponent(s)
        .replace(/!/g, '%21')
        .replace(/\*/g, '%2A')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');

    const params: Record<string, string> = {
      oauth_consumer_key: appKey,
      oauth_nonce: randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: accessToken,
      oauth_version: '1.0',
    };

    const paramString = Object.keys(params)
      .sort()
      .map((k) => `${pct(k)}=${pct(params[k])}`)
      .join('&');

    const baseString = [
      method.toUpperCase(),
      pct(url.split('?')[0]),
      pct(paramString),
    ].join('&');

    const signingKey = `${pct(appSecret)}&${pct(accessSecret)}`;
    params.oauth_signature = createHmac('sha1', signingKey)
      .update(baseString)
      .digest('base64');

    return (
      'OAuth ' +
      Object.keys(params)
        .sort()
        .map((k) => `${pct(k)}="${pct(params[k])}"`)
        .join(', ')
    );
  }

  private async uploadMedia(
    client: TwitterApi,
    postDetails: PostDetails<any>[]
  ) {
    return (
      await Promise.all(
        postDetails.flatMap((p) =>
          p?.media?.flatMap(async (m) => {
            return {
              id: await this.runInConcurrent(
                async () =>
                  client.v2.uploadMedia(
                    hasExtension(m.path, 'mp4')
                      ? Buffer.from(await readOrFetch(m.path))
                      : await sharp(await readOrFetch(m.path), {
                          animated: lookup(m.path) === 'image/gif',
                        })
                          .resize({
                            width: 1000,
                          })
                          .gif()
                          .toBuffer(),
                    {
                      media_type: (lookup(m.path) || '') as any,
                    }
                  ),
                true
              ),
              postId: p.id,
            };
          })
        )
      )
    ).reduce((acc, val) => {
      if (!val?.id) {
        return acc;
      }

      acc[val.postId] = acc[val.postId] || [];
      acc[val.postId].push(val.id);

      return acc;
    }, {} as Record<string, string[]>);
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<{
      active_thread_finisher: boolean;
      thread_finisher: string;
      community?: string;
      who_can_reply_post:
        | 'everyone'
        | 'following'
        | 'mentionedUsers'
        | 'subscribers'
        | 'verified';
      made_with_ai?: boolean;
      paid_partnership?: boolean;
    }>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [accessTokenSplit, accessSecretSplit] = accessToken.split(':');
    const appKey = clientInformation?.client_id || '';
    const appSecret = clientInformation?.client_secret || '';
    const client = await this.getClient(accessToken, appKey, appSecret);

    const [firstPost] = postDetails;

    // upload media for the first post
    const uploadAll = await this.uploadMedia(client, [firstPost]);

    const media_ids = (uploadAll[firstPost.id] || []).filter((f) => f);

    const tweetUrl = 'https://api.x.com/2/tweets';
    const tweetBody = {
      ...(!firstPost?.settings?.who_can_reply_post ||
      firstPost?.settings?.who_can_reply_post === 'everyone'
        ? {}
        : {
            reply_settings: firstPost?.settings?.who_can_reply_post,
          }),
      ...(firstPost?.settings?.community
        ? {
            share_with_followers: true,
            community_id:
              firstPost?.settings?.community?.split('/').pop() || '',
          }
        : {}),
      text: this.stripLinks()
        ? removeLinks(firstPost.message)
        : firstPost.message,
      ...(media_ids.length ? { media: { media_ids } } : {}),
      ...(firstPost.poll?.options?.length
        ? {
            poll: {
              options: firstPost.poll.options,
              duration_minutes: Math.min(Math.max(firstPost.poll.duration || 24, 5), 10080),
            },
          }
        : {}),
      made_with_ai: !!firstPost?.settings?.made_with_ai,
      paid_partnership: !!firstPost?.settings?.paid_partnership,
    };

    const tweetResponse = await this.fetch(tweetUrl, {
      method: 'POST',
      headers: {
        Authorization: this.signOAuth1(
          'POST',
          tweetUrl,
          accessTokenSplit,
          accessSecretSplit,
          appKey,
          appSecret
        ),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tweetBody),
    });
    const { data } = (await tweetResponse.json()) as {
      data: { id: string };
    };

    return [
      {
        postId: data.id,
        id: firstPost.id,
        releaseURL: `https://twitter.com/${integration.profile}/status/${data.id}`,
        status: 'posted',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<{
      active_thread_finisher: boolean;
      thread_finisher: string;
      made_with_ai?: boolean;
      paid_partnership?: boolean;
    }>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [accessTokenSplit, accessSecretSplit] = accessToken.split(':');
    const appKey = clientInformation?.client_id || '';
    const appSecret = clientInformation?.client_secret || '';
    const client = await this.getClient(accessToken, appKey, appSecret);
    const [commentPost] = postDetails;

    // upload media for the comment
    const uploadAll = await this.uploadMedia(client, [commentPost]);

    const media_ids = (uploadAll[commentPost.id] || []).filter((f) => f);

    const replyToId = lastCommentId || postId;

    const tweetUrl = 'https://api.x.com/2/tweets';
    const tweetBody = {
      text: this.stripLinks()
        ? removeLinks(commentPost.message)
        : commentPost.message,
      ...(media_ids.length ? { media: { media_ids } } : {}),
      reply: { in_reply_to_tweet_id: replyToId },
      made_with_ai: !!commentPost?.settings?.made_with_ai,
      paid_partnership: !!commentPost?.settings?.paid_partnership,
    };

    const tweetResponse = await this.fetch(tweetUrl, {
      method: 'POST',
      headers: {
        Authorization: this.signOAuth1(
          'POST',
          tweetUrl,
          accessTokenSplit,
          accessSecretSplit,
          appKey,
          appSecret
        ),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tweetBody),
    });
    const { data } = (await tweetResponse.json()) as {
      data: { id: string };
    };

    return [
      {
        postId: data.id,
        id: commentPost.id,
        releaseURL: `https://twitter.com/${integration.profile}/status/${data.id}`,
        status: 'posted',
      },
    ];
  }

  private readonly maxTimelinePageDepth = +(
    process.env.X_ANALYTICS_MAX_PAGE_DEPTH || '10'
  );

  private loadAllTweets = async (
    client: TwitterApi,
    id: string,
    until: string,
    since: string,
    maxPageDepth = this.maxTimelinePageDepth
  ): Promise<TweetV2[]> => {
    const allTweets: TweetV2[] = [];
    let token: string | undefined;
    let pages = 0;

    while (pages < maxPageDepth) {
      const tweets = await client.v2.userTimeline(id, {
        'tweet.fields': ['id'],
        'user.fields': [],
        'poll.fields': [],
        'place.fields': [],
        'media.fields': [],
        exclude: ['replies', 'retweets'],
        start_time: since,
        end_time: until,
        max_results: 100,
        ...(token ? { pagination_token: token } : {}),
      });

      allTweets.push(...tweets.data.data);
      pages++;

      if (tweets.data.data.length !== 100 || !tweets.meta.next_token) {
        break;
      }

      token = tweets.meta.next_token;
    }

    if (pages >= maxPageDepth) {
      this.logger.warn(
        `X loadAllTweets reached max page depth (${maxPageDepth}) for user ${id}; stopping pagination.`
      );
    }

    return allTweets;
  };

  async analytics(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    if (process.env.DISABLE_X_ANALYTICS) {
      return [];
    }

    const until = dayjs().endOf('day');
    const since = dayjs().subtract(date > 100 ? 100 : date, 'day');

    const [accessTokenSplit, accessSecretSplit] = accessToken.split(':');
    const appKey = clientInformation?.client_id || '';
    const appSecret = clientInformation?.client_secret || '';
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });

    try {
      const tweets = uniqBy(
        await this.loadAllTweets(
          client,
          id,
          until.format('YYYY-MM-DDTHH:mm:ssZ'),
          since.format('YYYY-MM-DDTHH:mm:ssZ')
        ),
        (p) => p.id
      );

      if (tweets.length === 0) {
        return [];
      }

      const data = await client.v2.tweets(
        tweets.map((p) => p.id),
        {
          'tweet.fields': ['public_metrics'],
        }
      );

      const metrics = data.data.reduce(
        (all, current) => {
          all.impression_count =
            (all.impression_count || 0) +
            +current.public_metrics.impression_count;
          all.bookmark_count =
            (all.bookmark_count || 0) + +current.public_metrics.bookmark_count;
          all.like_count =
            (all.like_count || 0) + +current.public_metrics.like_count;
          all.quote_count =
            (all.quote_count || 0) + +current.public_metrics.quote_count;
          all.reply_count =
            (all.reply_count || 0) + +current.public_metrics.reply_count;
          all.retweet_count =
            (all.retweet_count || 0) + +current.public_metrics.retweet_count;

          return all;
        },
        {
          impression_count: 0,
          bookmark_count: 0,
          like_count: 0,
          quote_count: 0,
          reply_count: 0,
          retweet_count: 0,
        }
      );

      return Object.entries(metrics).map(([key, value]) => ({
        label: key.replace('_count', '').replace('_', ' ').toUpperCase(),
        data: [
          {
            total: String(0),
            date: since.format('YYYY-MM-DD'),
          },
          {
            total: String(value),
            date: until.format('YYYY-MM-DD'),
          },
        ],
      }));
    } catch (err) {
      Logger.warn(`X analytics error: ${(err as Error)?.message || err}`);
    }
    return [];
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    if (process.env.DISABLE_X_ANALYTICS) {
      return [];
    }

    const today = dayjs().format('YYYY-MM-DD');

    const [accessTokenSplit, accessSecretSplit] = accessToken.split(':');
    const appKey = clientInformation?.client_id || '';
    const appSecret = clientInformation?.client_secret || '';
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });

    try {
      // Fetch the specific tweet with public metrics
      const tweet = await client.v2.singleTweet(postId, {
        'tweet.fields': ['public_metrics', 'created_at'],
      });

      if (!tweet?.data?.public_metrics) {
        return [];
      }

      const metrics = tweet.data.public_metrics;

      const result: AnalyticsData[] = [];

      if (metrics.impression_count !== undefined) {
        result.push({
          label: 'Impressions',
          data: [{ total: String(metrics.impression_count), date: today }],
        });
      }

      if (metrics.like_count !== undefined) {
        result.push({
          label: 'Likes',
          data: [{ total: String(metrics.like_count), date: today }],
        });
      }

      if (metrics.retweet_count !== undefined) {
        result.push({
          label: 'Retweets',
          data: [{ total: String(metrics.retweet_count), date: today }],
        });
      }

      if (metrics.reply_count !== undefined) {
        result.push({
          label: 'Replies',
          data: [{ total: String(metrics.reply_count), date: today }],
        });
      }

      if (metrics.quote_count !== undefined) {
        result.push({
          label: 'Quotes',
          data: [{ total: String(metrics.quote_count), date: today }],
        });
      }

      if (metrics.bookmark_count !== undefined) {
        result.push({
          label: 'Bookmarks',
          data: [{ total: String(metrics.bookmark_count), date: today }],
        });
      }

      return result;
    } catch (err) {
      Logger.warn(`X post analytics error: ${(err as Error)?.message}`);
    }

    return [];
  }

  override async mention(token: string, d: { query: string }, _id?: string, integration?: Integration) {
    const [accessTokenSplit, accessSecretSplit] = token.split(':');
    const appKey = integration ? getOrgCredential(integration.organizationId, 'x', 'clientId') || '' : '';
    const appSecret = integration ? getOrgCredential(integration.organizationId, 'x', 'clientSecret') || '' : '';
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken: accessTokenSplit,
      accessSecret: accessSecretSplit,
    });

    try {
      const data = await client.v2.userByUsername(d.query, {
        'user.fields': ['username', 'name', 'profile_image_url'],
      });

      if (!data?.data?.username) {
        return [];
      }

      return [
        {
          id: data.data.username,
          image: data.data.profile_image_url,
          label: data.data.name,
        },
      ];
    } catch (err) {
      Logger.warn(`X mention error: ${(err as Error)?.message || err}`);
    }
    return [];
  }

  mentionFormat(idOrHandle: string, name: string) {
    return `@${idOrHandle}`;
  }

  override get commentsCapabilities() {
    return { read: true, reply: true, like: true };
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    _integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const appKey = clientInformation?.client_id || '';
      const appSecret = clientInformation?.client_secret || '';
      const client = await this.getClient(accessToken, appKey, appSecret);

      const result = await client.v2.search(
        `conversation_id:${postId}`,
        {
          'tweet.fields': ['author_id', 'created_at', 'public_metrics', 'conversation_id'],
          'user.fields': ['username', 'name', 'profile_image_url'],
          expansions: ['author_id'],
          max_results: 100,
          ...(cursor ? { next_token: cursor } : {}),
        }
      );

      const users = (result?.includes?.users || []).reduce(
        (map: Record<string, any>, u: any) => {
          map[u.id] = u;
          return map;
        },
        {} as Record<string, any>
      );

      const comments: SocialCommentDTO[] = (result?.data?.data || []).map((tweet: any) => {
        const user = users[tweet.author_id] || {};
        return {
          platformCommentId: tweet.id,
          parentPlatformCommentId: tweet.referenced_tweets?.find(
            (ref: any) => ref.type === 'replied_to'
          )?.id,
          author: {
            id: tweet.author_id || '',
            name: user.name || user.username || '',
            username: user.username,
            picture: user.profile_image_url,
            profileUrl: `https://twitter.com/${user.username}`,
          },
          content: tweet.text || '',
          createdAt: tweet.created_at,
          likeCount: tweet.public_metrics?.like_count,
          replyCount: tweet.public_metrics?.reply_count,
          raw: tweet,
        };
      });

      const nextCursor = result?.meta?.next_token || undefined;

      return { comments, nextCursor };
    } catch (err) {
      this.logger.error(
        `X fetchComments error: ${(err as Error)?.message || 'unknown'}`
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
    _integration: Integration,
    clientInformation?: ClientInformation
  ) {
    try {
      const [accessTokenSplit, accessSecretSplit] = accessToken.split(':');
      const appKey = clientInformation?.client_id || '';
      const appSecret = clientInformation?.client_secret || '';

      const tweetUrl = 'https://api.x.com/2/tweets';
      const tweetBody = {
        text: this.stripLinks() ? removeLinks(message) : message,
        reply: { in_reply_to_tweet_id: parentCommentId },
      };

      const tweetResponse = await this.fetch(tweetUrl, {
        method: 'POST',
        headers: {
          Authorization: this.signOAuth1('POST', tweetUrl, accessTokenSplit, accessSecretSplit, appKey, appSecret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tweetBody),
      });

      const { data } = (await tweetResponse.json()) as { data: { id: string } };

      return {
        platformCommentId: data.id,
        parentPlatformCommentId: parentCommentId,
        author: {
          id: id,
          name: '',
          username: '',
        },
        content: message,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(
        `X replyToComment error: ${(err as Error)?.message || 'unknown'}`
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

  async likeComment(
    id: string,
    accessToken: string,
    _postId: string,
    commentId: string,
    like: boolean,
    _integration: Integration,
    clientInformation?: ClientInformation
  ) {
    try {
      const appKey = clientInformation?.client_id || '';
      const appSecret = clientInformation?.client_secret || '';
      const client = await this.getClient(accessToken, appKey, appSecret);
      const { data: { id: userId } } = await client.v2.me();

      if (like) {
        await client.v2.like(userId, commentId);
        return { liked: true };
      } else {
        await client.v2.unlike(userId, commentId);
        return { liked: false };
      }
    } catch (err) {
      this.logger.error(
        `X likeComment error: ${(err as Error)?.message || 'unknown'}`
      );
      throw err;
    }
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new XProvider();

export const xSocialModule: __ProviderModule<any, any> = {
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
