import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '../social-provider';
import { SocialCommentDTO } from '../social';
import { makeId, makeOauthState } from '../social-make-id';
import { SocialAbstract } from '../social-base';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { number, string } from 'yup';
import { htmlToText } from '@gitroom/helpers/utils/html.to.text';
import { Logger } from '@nestjs/common';
import { safeFetch } from '../social-base';

export class MastodonProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(MastodonProvider.name);
  override maxConcurrentJob = 5; // Mastodon instances typically have generous limits
  identifier = 'mastodon';
  name = 'Mastodon';
  isBetweenSteps = false;
  scopes = ['read:statuses', 'write:statuses', 'profile', 'write:media'];
  editor = 'normal' as const;

  override get commentsCapabilities() {
    return { read: true, reply: true, like: true };
  }
  maxLength() {
    return 500;
  }

  override handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.includes('Your login is currently disabled')) {
      return {
        type: 'refresh-token',
        value: 'Your login is currently disabled',
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
  protected generateUrlDynamic(
    customUrl: string,
    state: string,
    clientId: string,
    url: string
  ) {
    return `${customUrl}/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
      `${url}/integrations/social/mastodon`
    )}&scope=${this.scopes.join('+')}&state=${state}`;
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const instanceUrl = clientInformation?.instanceUrl || 'https://mastodon.social';
    const clientId = clientInformation?.client_id || '';
    const url = this.generateUrlDynamic(
      instanceUrl,
      state,
      clientId,
      process.env.FRONTEND_URL || 'http://localhost:5000'
    );
    return {
      url,
      codeVerifier: makeId(10),
      state,
    };
  }

  protected async dynamicAuthenticate(
    clientId: string,
    clientSecret: string,
    url: string,
    code: string
  ) {
    const form = new FormData();
    form.append('client_id', clientId);
    form.append('client_secret', clientSecret);
    form.append('code', code);
    form.append('grant_type', 'authorization_code');
    form.append(
      'redirect_uri',
      `${process.env.FRONTEND_URL}/integrations/social/mastodon`
    );
    form.append('scope', this.scopes.join(' '));

    const tokenInformation = await (
      await this.fetch(`${url}/oauth/token`, {
        method: 'POST',
        body: form,
      })
    ).json();

    const personalInformation = await (
      await this.fetch(`${url}/api/v1/accounts/verify_credentials`, {
        headers: {
          Authorization: `Bearer ${tokenInformation.access_token}`,
        },
      })
    ).json();

    return {
      id: personalInformation.id,
      name: personalInformation.display_name || personalInformation.acct,
      accessToken: tokenInformation.access_token,
      refreshToken: 'null',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: personalInformation?.avatar || '',
      username: personalInformation.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }, clientInformation?: ClientInformation) {
    return this.dynamicAuthenticate(
      clientInformation?.client_id || '',
      clientInformation?.client_secret || '',
      clientInformation?.instanceUrl || 'https://mastodon.social',
      params.code
    );
  }

  async uploadFile(
    instanceUrl: string,
    fileUrl: string,
    accessToken: string,
    alt?: string
  ) {
    const form = new FormData();
    form.append('file', await safeFetch(fileUrl).then((r) => r.blob()));
    if (alt) {
      form.append('description', alt);
    }
    const media = await (
      await this.fetch(`${instanceUrl}/api/v1/media`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      })
    ).json();
    return media.id;
  }

  async dynamicPost(
    id: string,
    accessToken: string,
    url: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const uploadFiles = await Promise.all(
      firstPost?.media?.map((media) =>
        this.uploadFile(url, media.path, accessToken, media.alt)
      ) || []
    );

    const form = new FormData();
    form.append('status', firstPost.message);
    form.append('visibility', 'public');
    if (uploadFiles.length) {
      for (const file of uploadFiles) {
        form.append('media_ids[]', file);
      }
    }

    const post = await (
      await this.fetch(`${url}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      })
    ).json();

    return [
      {
        id: firstPost.id,
        postId: post.id,
        releaseURL: `${url}/statuses/${post.id}`,
        status: 'completed',
      },
    ];
  }

  async dynamicComment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    url: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    const uploadFiles = await Promise.all(
      commentPost?.media?.map((media) =>
        this.uploadFile(url, media.path, accessToken, media.alt)
      ) || []
    );

    const form = new FormData();
    form.append('status', commentPost.message);
    form.append('visibility', 'public');
    form.append('in_reply_to_id', replyToId);
    if (uploadFiles.length) {
      for (const file of uploadFiles) {
        form.append('media_ids[]', file);
      }
    }

    const post = await (
      await this.fetch(`${url}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      })
    ).json();

    return [
      {
        id: commentPost.id,
        postId: post.id,
        releaseURL: `${url}/statuses/${post.id}`,
        status: 'completed',
      },
    ];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration?: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const instanceUrl = clientInformation?.instanceUrl || 'https://mastodon.social';
    return this.dynamicPost(
      id,
      accessToken,
      instanceUrl,
      postDetails
    );
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const instanceUrl = clientInformation?.instanceUrl || 'https://mastodon.social';
    return this.dynamicComment(
      id,
      postId,
      lastCommentId,
      accessToken,
      instanceUrl,
      postDetails
    );
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    _cursor: string | undefined,
    _integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const instanceUrl = clientInformation?.instanceUrl || 'https://mastodon.social';

      const context = await (
        await this.fetch(`${instanceUrl}/api/v1/statuses/${postId}/context`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json() as { ancestors: any[]; descendants: any[] };

      const comments: SocialCommentDTO[] = (context.descendants || []).map((s: any) => ({
        platformCommentId: s.id,
        parentPlatformCommentId: s.in_reply_to_id || undefined,
        author: {
          id: s.account?.id || '',
          name: s.account?.display_name || s.account?.acct || '',
          username: s.account?.acct || s.account?.username,
          picture: s.account?.avatar,
          profileUrl: s.account?.url,
        },
        content: htmlToText(s.content),
        createdAt: s.created_at,
        likeCount: s.favourites_count,
        replyCount: s.replies_count,
        likedByMe: !!s.favourited,
        raw: s,
      }));

      return { comments, nextCursor: undefined };
    } catch (err) {
      this.logger.error(`Mastodon fetchComments error: ${(err as Error)?.message || String(err)}`);
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
      const instanceUrl = clientInformation?.instanceUrl || 'https://mastodon.social';

      const form = new FormData();
      form.append('status', message);
      form.append('in_reply_to_id', parentCommentId);

      const response = await (
        await this.fetch(`${instanceUrl}/api/v1/statuses`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        })
      ).json() as any;

      return {
        platformCommentId: response.id,
        parentPlatformCommentId: response.in_reply_to_id || undefined,
        author: {
          id: response.account?.id || '',
          name: response.account?.display_name || response.account?.acct || '',
          username: response.account?.acct || response.account?.username,
          picture: response.account?.avatar,
          profileUrl: response.account?.url,
        },
        content: htmlToText(response.content) || message,
        createdAt: response.created_at,
      };
    } catch (err) {
      this.logger.error(`Mastodon replyToComment error: ${(err as Error)?.message || String(err)}`);
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
    const instanceUrl = clientInformation?.instanceUrl || 'https://mastodon.social';
    const endpoint = like ? 'favourite' : 'unfavourite';

    try {
      const response = await (
        await this.fetch(`${instanceUrl}/api/v1/statuses/${commentId}/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json() as any;

      return { liked: like, likeCount: response.favourites_count };
    } catch (err: any) {
      // Surface the failure so the caller (service → UI) can revert the
      // optimistic toggle and tell the user, rather than reporting a fake state.
      this.logger.error(`Mastodon likeComment error: ${err?.message || String(err)}`);
      throw err;
    }
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    try {
      const instanceUrl =
        clientInformation?.instanceUrl || 'https://mastodon.social';
      const account = (await (
        await this.fetch(`${instanceUrl}/api/v1/accounts/${id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json()) as any;

      const followers = account?.followers_count;
      if (followers === undefined || followers === null) {
        return [];
      }
      return [
        {
          label: 'Followers',
          data: [
            { total: String(followers), date: dayjs().format('YYYY-MM-DD') },
          ],
        },
      ];
    } catch (err) {
      this.logger.warn(`Mastodon analytics failed: ${(err as Error)?.message}`);
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    try {
      const instanceUrl =
        clientInformation?.instanceUrl || 'https://mastodon.social';
      const status = (await (
        await this.fetch(`${instanceUrl}/api/v1/statuses/${postId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json()) as any;

      const today = dayjs().format('YYYY-MM-DD');
      const result: AnalyticsData[] = [];
      const push = (label: string, value: unknown) => {
        if (value !== undefined && value !== null) {
          result.push({ label, data: [{ total: String(value), date: today }] });
        }
      };

      push('Favourites', status?.favourites_count);
      push('Reblogs', status?.reblogs_count);
      push('Replies', status?.replies_count);

      return result;
    } catch (err) {
      this.logger.warn(`Mastodon postAnalytics failed: ${(err as Error)?.message}`);
      return [];
    }
  }
}
