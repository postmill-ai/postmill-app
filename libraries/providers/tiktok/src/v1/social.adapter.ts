import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { makeOauthState } from '@gitroom/provider-kernel';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import { TikTokDto } from '@gitroom/provider-kernel';
import { timer } from '@gitroom/helpers/utils/timer';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/provider-kernel';


import { metadata as providerMetadata } from './metadata';
@Rules(
  'TikTok can have one video or one picture or multiple pictures, it cannot be without an attachment'
)
export class TiktokProvider extends SocialAbstract implements SocialProvider {
  identifier = 'tiktok';
  name = 'Tiktok';
  isBetweenSteps = false;
  convertToJPEG = true;
  scopes = [
    'video.list',
    'user.info.basic',
    'video.publish',
    'video.upload',
    'user.info.profile',
    'user.info.stats',
  ];
  override maxConcurrentJob = 300;
  dto = TikTokDto;
  editor = 'normal' as const;
  maxLength() {
    return 2000;
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

  override async checkValidity(
    items: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const [firstItems] = items ?? [];
    if ((firstItems?.length ?? 0) === 0) {
      return 'No video / images selected';
    }
    if (
      (firstItems?.length ?? 0) > 1 &&
      firstItems?.some((p) => (p?.path?.indexOf?.('mp4') ?? -1) > -1)
    ) {
      return 'Only pictures are supported when selecting multiple items';
    } else if (
      firstItems?.length !== 1 &&
      (firstItems?.[0]?.path?.indexOf?.('mp4') ?? -1) > -1
    ) {
      return 'You need one media';
    }
    return true;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Authentication/Authorization errors - require re-authentication
    if (body.indexOf('access_token_invalid') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'Access token invalid, please re-authenticate your TikTok account',
      };
    }

    if (body.indexOf('scope_not_authorized') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Missing required permissions, please re-authenticate with all scopes',
      };
    }

    if (body.indexOf('scope_permission_missed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Additional permissions required, please re-authenticate',
      };
    }

    // Rate limiting errors
    if (body.indexOf('rate_limit_exceeded') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok API rate limit exceeded, please try again later',
      };
    }

    if (body.indexOf('file_format_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'File format is invalid, please check video specifications',
      };
    }

    if (body.indexOf('app_version_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'In order to use the TikTok upload feature, you have to update your app to the latest version',
      };
    }

    if (body.indexOf('duration_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video duration is invalid, please check video specifications',
      };
    }

    if (body.indexOf('frame_rate_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video frame rate is invalid, please check video specifications',
      };
    }

    if (body.indexOf('video_pull_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to pull video from URL, please check the URL',
      };
    }

    if (body.indexOf('photo_pull_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to pull photo from URL, please check the URL',
      };
    }

    if (body.indexOf('spam_risk_user_banned_from_posting') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Account banned from posting, please check TikTok account status',
      };
    }

    if (body.indexOf('spam_risk_text') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok detected potential spam in the post text',
      };
    }

    if (body.indexOf('spam_risk_too_many_posts') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'TikTok says your daily post limit reached, please try again tomorrow',
      };
    }

    if (body.indexOf('spam_risk_too_many_pending_share') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'TikTok limits pending posts to 5 within any 24-hour period. Please check your TikTok inbox in the TikTok mobile app and try again after 24 hours.',
      };
    }

    if (body.indexOf('spam_risk_user_banned_from_posting') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Account banned from posting, please check TikTok account status',
      };
    }

    if (body.indexOf('spam_risk') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok detected potential spam',
      };
    }

    if (body.indexOf('reached_active_user_cap') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Daily active user quota reached, please try again later',
      };
    }

    if (
      body.indexOf('unaudited_client_can_only_post_to_private_accounts') > -1
    ) {
      return {
        type: 'bad-body' as const,
        value: 'App not approved for public posting, contact support',
      };
    }

    if (body.indexOf('url_ownership_unverified') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You have to upload the picture/video to Postmill when sending a URL',
      };
    }

    if (body.indexOf('privacy_level_option_mismatch') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Privacy level mismatch, please check privacy settings',
      };
    }

    // Content/Format validation errors
    if (body.indexOf('invalid_file_upload') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid file format or specifications not met',
      };
    }

    if (body.indexOf('invalid_params') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid request parameters, please check content format',
      };
    }

    // Server errors
    if (body.indexOf('internal') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'There is a problem with TikTok servers, please try again later',
      };
    }

    // Generic TikTok API errors
    if (body.indexOf('picture_size_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video must be at least 720p, Picture must no exceed 1080p',
      };
    }

    if (body.indexOf('TikTok API error') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok API error, please try again',
      };
    }

    // Fall back to parent class error handling
    return undefined;
  }

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const value = {
      client_key: clientInformation?.client_id || '',
      client_secret: clientInformation?.client_secret || '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    const tokenResponse = await this.fetch(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        body: new URLSearchParams(value).toString(),
      }
    );
    const { access_token, refresh_token, ...all } = await tokenResponse.json();

    const userResponse = await this.fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );
    const {
      data: {
        user: { avatar_url, display_name, open_id, username },
      },
    } = await userResponse.json();

    return {
      refreshToken: refresh_token,
      expiresIn: dayjs().add(23, 'hours').unix() - dayjs().unix(),
      accessToken: access_token,
      id: open_id.replace(/-/g, ''),
      name: display_name,
      picture: avatar_url || '',
      username: username,
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();

    return {
      url:
        'https://www.tiktok.com/v2/auth/authorize/' +
        `?client_key=${clientInformation?.client_id || ''}` +
        `&redirect_uri=${encodeURIComponent(
          this._buildRedirectUri('/integrations/social/tiktok')
        )}` +
        `&state=${state}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: state,
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }, clientInformation?: ClientInformation) {
    const value = {
      client_key: clientInformation?.client_id || '',
      client_secret: clientInformation?.client_secret || '',
      code: params.code,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
      redirect_uri: this._buildRedirectUri('/integrations/social/tiktok'),
    };

    const tokenResponse = await this.fetch(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        body: new URLSearchParams(value).toString(),
      }
    );
    const { access_token, refresh_token, scope } = await tokenResponse.json();

    this.checkScopes(this.scopes, scope);

    const userResponse = await this.fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );
    const {
      data: {
        user: { avatar_url, display_name, open_id, username },
      },
    } = await userResponse.json();

    return {
      id: open_id.replace(/-/g, ''),
      name: display_name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: dayjs().add(23, 'hours').unix() - dayjs().unix(),
      picture: avatar_url,
      username: username,
    };
  }

  async maxVideoLength(accessToken: string) {
    const response = await this.fetch(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    const {
      data: { max_video_post_duration_sec },
    } = await response.json();

    return {
      maxDurationSeconds: max_video_post_duration_sec,
    };
  }

  private async uploadedVideoSuccess(
    id: string,
    publishId: string,
    accessToken: string
  ): Promise<{ url: string; id: string }> {
    const maxAttempts = 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const post = await (
        await this.fetch(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              publish_id: publishId,
            }),
          },
          '',
          0,
          true
        )
      ).json();

      const { status, publicaly_available_post_id } = post.data;

      if (status === 'SEND_TO_USER_INBOX') {
        return {
          url: 'https://www.tiktok.com/messages?lang=en',
          id: 'missing',
        };
      }

      if (status === 'PUBLISH_COMPLETE') {
        return {
          url: !publicaly_available_post_id
            ? `https://www.tiktok.com/@${id}`
            : `https://www.tiktok.com/@${id}/video/` +
              publicaly_available_post_id,
          id: !publicaly_available_post_id
            ? publishId
            : publicaly_available_post_id?.[0],
        };
      }

      if (status === 'FAILED') {
        const handleError = this.handleErrors(JSON.stringify(post));
        throw new BadBody(
          'titok-error-upload',
          JSON.stringify(post),
          Buffer.from(JSON.stringify(post)),
          handleError?.value || ''
        );
      }

      if (attempt === maxAttempts) {
        throw new BadBody(
          'tiktok-publish-timeout',
          JSON.stringify({ publishId, status }),
          Buffer.from(JSON.stringify({ publishId, status })),
          `TikTok publish status did not become terminal after ${maxAttempts} attempts (last status: ${status})`
        );
      }

      await timer(10000);
    }

    throw new Error(
      `TikTok publish status polling exited unexpectedly for ${publishId}`
    );
  }

  private postingMethod(
    method: TikTokDto['content_posting_method'],
    isPhoto: boolean
  ): string {
    switch (method) {
      case 'UPLOAD':
        return isPhoto ? '/content/init/' : '/inbox/video/init/';
      case 'DIRECT_POST':
      default:
        return isPhoto ? '/content/init/' : '/video/init/';
    }
  }

  private buildTikokPostInfoBody(firstPost: PostDetails<TikTokDto>) {
    const isPhoto = !hasExtension(firstPost?.media?.[0]?.path, 'mp4');
    const method = firstPost?.settings?.content_posting_method;

    if (method === 'DIRECT_POST') {
      return {
        post_info: {
          ...(isPhoto && firstPost.settings.title
            ? { title: firstPost.settings.title.slice(0, 90) }
            : {}),
          ...(!isPhoto && firstPost.message
            ? { title: firstPost.message }
            : {}),
          ...(isPhoto ? { description: firstPost.message } : {}),
          privacy_level:
            firstPost.settings.privacy_level || 'PUBLIC_TO_EVERYONE',
          ...(isPhoto
            ? {}
            : { disable_duet: !firstPost.settings.duet || false }),
          disable_comment: !firstPost.settings.comment || false,
          ...(isPhoto
            ? {}
            : { disable_stitch: !firstPost.settings.stitch || false }),
          ...(isPhoto
            ? {}
            : { is_aigc: firstPost.settings.video_made_with_ai || false }),
          brand_content_toggle:
            firstPost.settings.brand_content_toggle || false,
          brand_organic_toggle:
            firstPost.settings.brand_organic_toggle || false,
          ...(isPhoto
            ? {
                auto_add_music: firstPost.settings.autoAddMusic === 'yes',
              }
            : {}),
        },
      };
    }

    return {
      post_info: {
        ...(isPhoto && firstPost.settings.title
          ? { title: firstPost.settings.title }
          : {}),
        ...(!isPhoto && firstPost.message ? { title: firstPost.message } : {}),
        ...(isPhoto ? { description: firstPost.message } : {}),
      },
    };
  }

  private buildTikokSourceInfoBody(firstPost: PostDetails<TikTokDto>) {
    const isPhoto = !hasExtension(firstPost?.media?.[0]?.path, 'mp4');

    if (isPhoto) {
      return {
        post_mode:
          firstPost?.settings?.content_posting_method === 'DIRECT_POST'
            ? 'DIRECT_POST'
            : 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: firstPost.media?.map((p) => p.path),
        },
      };
    }

    return {
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: firstPost?.media?.[0]?.path,
        ...(firstPost?.media?.[0]?.thumbnailTimestamp
          ? {
              video_cover_timestamp_ms:
                firstPost?.media?.[0]?.thumbnailTimestamp,
            }
          : {}),
      },
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<TikTokDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const isPhoto = !hasExtension(firstPost?.media?.[0]?.path, 'mp4');

    const {
      data: { publish_id },
    } = await (
      await this.fetch(
        `https://open.tiktokapis.com/v2/post/publish${this.postingMethod(
          firstPost.settings.content_posting_method,
          !hasExtension(firstPost?.media?.[0]?.path, 'mp4')
        )}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...this.buildTikokPostInfoBody(firstPost),
            ...this.buildTikokSourceInfoBody(firstPost),
          }),
        }
      )
    ).json();

    const { url, id: videoId } = await this.uploadedVideoSuccess(
      integration.profile!,
      publish_id,
      accessToken
    );

    return [
      {
        id: firstPost.id,
        releaseURL: url,
        postId: String(videoId),
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Get user stats (follower_count, following_count, likes_count, video_count)
      const userStatsResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const userStatsData = await userStatsResponse.json();
      const userStats = userStatsData?.data?.user;

      const result: AnalyticsData[] = [];

      if (userStats) {
        if (userStats.follower_count !== undefined) {
          result.push({
            label: 'Followers',
            data: [{ total: String(userStats.follower_count), date: today }],
          });
        }

        if (userStats.following_count !== undefined) {
          result.push({
            label: 'Following',
            data: [{ total: String(userStats.following_count), date: today }],
          });
        }

        if (userStats.likes_count !== undefined) {
          result.push({
            label: 'Total Likes',
            data: [{ total: String(userStats.likes_count), date: today }],
          });
        }

        if (userStats.video_count !== undefined) {
          result.push({
            label: 'Videos',
            data: [{ total: String(userStats.video_count), date: today }],
          });
        }
      }

      // Get recent videos and aggregate their stats
      const videoListResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ max_count: 20 }),
        }
      );

      const videoListData = await videoListResponse.json();
      const videos = videoListData?.data?.videos;

      if (videos && videos.length > 0) {
        const videoIds = videos.map((v: { id: string }) => v.id);

        // Query video details to get engagement metrics
        const videoQueryResponse = await this.fetch(
          'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              filters: { video_ids: videoIds },
            }),
          }
        );

        const videoQueryData = await videoQueryResponse.json();
        const videoDetails = videoQueryData?.data?.videos;

        if (videoDetails && videoDetails.length > 0) {
          let totalViews = 0;
          let totalLikes = 0;
          let totalComments = 0;
          let totalShares = 0;

          for (const video of videoDetails) {
            totalViews += video.view_count || 0;
            totalLikes += video.like_count || 0;
            totalComments += video.comment_count || 0;
            totalShares += video.share_count || 0;
          }

          result.push({
            label: 'Views',
            data: [{ total: String(totalViews), date: today }],
          });

          result.push({
            label: 'Recent Likes',
            data: [{ total: String(totalLikes), date: today }],
          });

          result.push({
            label: 'Recent Comments',
            data: [{ total: String(totalComments), date: today }],
          });

          result.push({
            label: 'Recent Shares',
            data: [{ total: String(totalShares), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error(
        'Error fetching TikTok analytics:',
        (err as Error)?.message || 'unknown'
      );
      return [];
    }
  }

  async missing(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]> {
    try {
      const videoListResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,cover_image_url,title',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ max_count: 20 }),
        }
      );

      const videoListData = await videoListResponse.json();
      const videos = videoListData?.data?.videos;

      if (!videos || videos.length === 0) {
        return [];
      }

      return videos.map((v: { id: string; cover_image_url: string }) => ({
        id: String(v.id),
        url: v.cover_image_url,
      }));
    } catch (err) {
      console.error(
        'Error fetching TikTok missing content:',
        (err as Error)?.message || 'unknown'
      );
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    if (postId.indexOf('v_pub_url') > -1) {
      const post = await (
        await this.fetch(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              publish_id: postId,
            }),
          },
          '',
          0,
          true
        )
      ).json();

      if (!post?.data?.publicaly_available_post_id?.[0]) {
        return [];
      }

      postId = post.data.publicaly_available_post_id[0];
    }

    try {
      // Query video details using the video ID
      const response = await this.fetch(
        'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            filters: {
              video_ids: [postId],
            },
          }),
        }
      );

      const data = await response.json();
      const video = data?.data?.videos?.[0];

      if (!video) {
        return [];
      }

      const result: AnalyticsData[] = [];

      if (video.view_count !== undefined) {
        result.push({
          label: 'Views',
          data: [{ total: String(video.view_count), date: today }],
        });
      }

      if (video.like_count !== undefined) {
        result.push({
          label: 'Likes',
          data: [{ total: String(video.like_count), date: today }],
        });
      }

      if (video.comment_count !== undefined) {
        result.push({
          label: 'Comments',
          data: [{ total: String(video.comment_count), date: today }],
        });
      }

      if (video.share_count !== undefined) {
        result.push({
          label: 'Shares',
          data: [{ total: String(video.share_count), date: today }],
        });
      }

      return result;
    } catch (err) {
      console.error(
        'Error fetching TikTok post analytics:',
        (err as Error)?.message || 'unknown'
      );
      return [];
    }
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
      let url = `https://open.tiktokapis.com/v2/video/comment/list/?video_id=${postId}&fields=id,text,create_time,user_id,username,like_count,reply_count`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }

      const response = await this.fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const json = await response.json() as any;
      const data = json?.data || {};
      const commentsList = data.comments || [];

      const comments: SocialCommentDTO[] = commentsList.map((c: any) => ({
        platformCommentId: c.id,
        author: {
          id: c.user_id || '',
          name: c.username || '',
          username: c.username,
          picture: c.user?.avatar_url,
        },
        content: c.text || '',
        createdAt: new Date(c.create_time * 1000).toISOString(),
        likeCount: c.like_count,
        replyCount: c.reply_count,
        raw: c,
      }));

      return { comments, nextCursor: data.cursor };
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
      const response = await this.fetch(
        'https://open.tiktokapis.com/v2/video/comment/reply/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_id: postId,
            comment_id: parentCommentId,
            text: message,
          }),
        }
      );
      const json = await response.json() as any;
      const comment = json?.data?.comment;

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
    // Platform does not support native comment likes
    return { liked: like };
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new TiktokProvider();

export const tiktokSocialModule: __ProviderModule<any, any> = {
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
