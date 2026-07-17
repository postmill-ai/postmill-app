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
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import { Readable } from 'node:stream';
import { safeFetch, YoutubeSettingsDto } from '@gitroom/provider-kernel';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { GaxiosResponse } from 'gaxios/build/src/common';
import Schema$Video = youtube_v3.Schema$Video;
import { Rules } from '@gitroom/provider-kernel';
import { Integration } from '@prisma/client';
import { Logger } from '@nestjs/common';

import { metadata as providerMetadata } from './metadata';

// S-17 / known proxy gap: the googleapis SDK creates its own Gaxios/OAuth2 HTTP
// clients and does not expose a hook that accepts an undici Dispatcher. The
// per-channel VPN dispatcher returned by SocialAbstract.fetch() (via
// getVpnDispatcher()) therefore cannot be applied to YouTube OAuth token calls or
// to youtube/v3, youtubeAnalytics/v2, or oauth2/v2 API calls. SSRF protection is
// still present for fixed *.googleapis.com hosts via normal TCP routing; the gap
// is specifically per-channel VPN egress. Closing it would require a custom
// Gaxios adapter/fetchImplementation that translates GaxiosOptions into undici
// requests with the active dispatcher.
let _clientAndYoutube: {
  client: OAuth2Client;
  youtube: (newClient: OAuth2Client) => ReturnType<typeof google.youtube>;
  oauth2: (newClient: OAuth2Client) => ReturnType<typeof google.oauth2>;
  youtubeAnalytics: (newClient: OAuth2Client) => ReturnType<typeof google.youtubeAnalytics>;
} | undefined;

const clientAndYoutube = (clientId?: string, clientSecret?: string) => {
  const useClientId = clientId || '';
  const useClientSecret = clientSecret || '';

  if (!clientId && !clientSecret && _clientAndYoutube) return _clientAndYoutube;

  const client = new google.auth.OAuth2({
    clientId: useClientId,
    clientSecret: useClientSecret,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
  });

  const youtube = (newClient: OAuth2Client) =>
    google.youtube({
      version: 'v3',
      auth: newClient,
    });

  const youtubeAnalytics = (newClient: OAuth2Client) =>
    google.youtubeAnalytics({
      version: 'v2',
      auth: newClient,
    });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  if (!clientId && !clientSecret) {
    _clientAndYoutube = { client, youtube, oauth2, youtubeAnalytics };
  }

  return { client, youtube, oauth2, youtubeAnalytics };
};

@Rules('YouTube must have on video attachment, it cannot be empty')
export class YoutubeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 200; // YouTube has strict upload quotas
  identifier = 'youtube';
  name = 'YouTube';
  isBetweenSteps = true;
  dto = YoutubeSettingsDto;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  private readonly logger = new Logger(YoutubeProvider.name);

  editor = 'normal' as const;
  maxLength() {
    return 5000;
  }

  override async checkValidity(
    items: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const [firstItems] = items ?? [];
    if (items?.[0]?.length !== 1) {
      return 'You need one media';
    }
    if ((firstItems?.[0]?.path?.indexOf?.('mp4') ?? -1) === -1) {
      return 'Item must be a video';
    }
    return true;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('invalidTags')) {
      return {
        type: 'bad-body',
        value:
          'The maximum allowed is 500 characters in total.',
      };
    }

    if (body.includes('invalidTitle')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the title. Title is too long.',
      };
    }

    if (body.includes('invalidDescription')) {
      return {
        type: 'bad-body',
        value:
          'Your video description is invalid, it may contain disallowed characters such as < or >.',
      };
    }

    if (body.includes('invalidCategoryId')) {
      return {
        type: 'bad-body',
        value: 'The selected video category is invalid.',
      };
    }

    if (body.includes('invalidPublishAt')) {
      return {
        type: 'bad-body',
        value: 'The scheduled publishing time is invalid.',
      };
    }

    if (body.includes('invalidRecordingDetails')) {
      return {
        type: 'bad-body',
        value: 'The recording details for the video are invalid.',
      };
    }

    if (body.includes('invalidVideoGameRating')) {
      return {
        type: 'bad-body',
        value: 'The video game rating is invalid.',
      };
    }

    if (body.includes('invalidFilename')) {
      return {
        type: 'bad-body',
        value: 'The video file name is invalid.',
      };
    }

    if (body.includes('defaultLanguageNotSet')) {
      return {
        type: 'bad-body',
        value:
          'We could not set the localized video details because no default language is set.',
      };
    }

    if (body.includes('invalidVideoMetadata')) {
      return {
        type: 'bad-body',
        value:
          'Some of the video details are invalid, please review the title, description and tags.',
      };
    }

    if (body.includes('mediaBodyRequired')) {
      return {
        type: 'bad-body',
        value:
          'The video file is missing or could not be read, please re-upload the video.',
      };
    }

    if (body.includes('imageFormatUnsupported')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the thumbnail format is not supported, please use JPEG or PNG.',
      };
    }

    if (body.includes('imageTooTall')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the thumbnail image is too tall.',
      };
    }

    if (body.includes('imageTooWide')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but the thumbnail image is too wide.',
      };
    }

    if (body.includes('rateLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You are sending requests too quickly, please wait a little while and try again.',
      };
    }

    if (body.includes('failedPrecondition')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.',
      };
    }

    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You have reached your daily upload limit, please try again tomorrow.',
      };
    }

    if (body.includes('youtubeSignupRequired')) {
      return {
        type: 'bad-body',
        value:
          'You have to link your youtube account to your google account first.',
      };
    }

    if (body.includes('youtube.thumbnail')) {
      return {
        type: 'bad-body',
        value:
          'Your account is not verified, we have uploaded your video but we could not set the thumbnail. Please verify your account and try again.',
      };
    }

    if (body.includes('Unauthorized')) {
      return {
        type: 'refresh-token',
        value:
          'Token expired or invalid, please reconnect your YouTube account.',
      };
    }

    if (body.includes('UNAUTHENTICATED') || body.includes('invalid_grant')) {
      return {
        type: 'refresh-token',
        value: 'Please re-authenticate your YouTube account',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndYoutube(
      clientInformation?.client_id,
      clientInformation?.client_secret
    );
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new Error('Failed to refresh YouTube access token');
    }
    if (!credentials.expiry_date) {
      throw new Error('Failed to get YouTube token expiry date');
    }
    const user = oauth2(client);
    const expiryDate = new Date(credentials.expiry_date);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token,
      expiresIn: unixTimestamp,
      refreshToken: credentials.refresh_token ?? refresh_token,
      id: String(data.id || ''),
      name: data.name || '',
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const { client } = clientAndYoutube(
      clientInformation?.client_id,
      clientInformation?.client_secret
    );
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeId(11),
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
    const { client, oauth2 } = clientAndYoutube(
      clientInformation?.client_id,
      clientInformation?.client_secret
    );
    const { tokens } = await client.getToken(params.code);
    if (!tokens.access_token) {
      throw new Error('Failed to get YouTube access token');
    }
    if (!tokens.expiry_date) {
      throw new Error('Failed to get YouTube token expiry date');
    }
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    return {
      accessToken: tokens.access_token,
      expiresIn: unixTimestamp,
      refreshToken: tokens.refresh_token || '',
      id: String(data.id || ''),
      name: data.name || '',
      picture: data?.picture || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      // Get all channels the user has access to
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        mine: true,
      });

      const channels = response.data.items || [];

      return channels.map((channel) => ({
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        picture: {
          data: {
            url: channel.snippet?.thumbnails?.default?.url || '',
          },
        },
        username: channel.snippet?.customUrl || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
      }));
    } catch (error) {
      console.error(
        'Failed to fetch YouTube channels:',
        (error as Error)?.message || 'unknown'
      );
      return [];
    }
  }

  async fetchPageInformation(accessToken: string, data: { id: string }) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [data.id],
      });

      const channel = response.data.items?.[0];

      if (!channel) {
        throw new Error('Channel not found');
      }

      return {
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        access_token: accessToken,
        picture: channel.snippet?.thumbnails?.default?.url || '',
        username: channel.snippet?.customUrl || '',
      };
    } catch (error) {
      console.error(
        'Failed to fetch YouTube channel information:',
        (error as Error)?.message || 'unknown'
      );
      throw error;
    }
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const pages = await this.pages(accessToken);
    const findPage = pages.find((p) => p.id === requiredId);

    if (!findPage) {
      throw new Error('Channel not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;

    const mediaPath = firstPost?.media?.[0]?.path;
    const mediaResponse = await safeFetch(mediaPath);
    if (!mediaResponse.ok) {
      throw new Error(
        `Failed to fetch media: ${mediaResponse.status} ${mediaResponse.statusText}`
      );
    }

    const all: GaxiosResponse<Schema$Video> = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.insert({
          part: ['id', 'snippet', 'status'],
          notifySubscribers: true,
          requestBody: {
            snippet: {
              title: settings.title,
              description: firstPost?.message,
              ...(settings?.tags?.length
                ? { tags: settings.tags.map((p) => p.label) }
                : {}),
            },
            status: {
              privacyStatus: settings.type,
              selfDeclaredMadeForKids:
                settings.selfDeclaredMadeForKids === 'yes',
            },
          },
          media: {
            body: Readable.fromWeb(mediaResponse.body as any),
          },
        }),
      true
    );

    if (settings?.thumbnail?.path) {
      const thumbnailResponse = await safeFetch(settings.thumbnail.path);
      if (!thumbnailResponse.ok) {
        throw new Error(
          `Failed to fetch thumbnail: ${thumbnailResponse.status} ${thumbnailResponse.statusText}`
        );
      }
      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId: all?.data?.id!,
          media: {
            body: Readable.fromWeb(thumbnailResponse.body as any),
          },
        })
      );
    }

    return [
      {
        id: firstPost.id,
        releaseURL: `https://www.youtube.com/watch?v=${all?.data?.id}`,
        postId: all?.data?.id!,
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(date, 'day').format('YYYY-MM-DD');

      const { client, youtubeAnalytics } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });

      const youtubeClient = youtubeAnalytics(client);
      const { data } = await youtubeClient.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,subscribersLost',
        dimensions: 'day',
        sort: 'day',
      });

      const columns = data?.columnHeaders?.map((p) => p.name)!;
      const mappedData = data?.rows?.map((p) => {
        return columns.reduce((acc, curr, index) => {
          acc[curr!] = p[index];
          return acc;
        }, {} as any);
      });

      const acc = [] as any[];
      acc.push({
        label: 'Estimated Minutes Watched',
        data: mappedData?.map((p: any) => ({
          total: p.estimatedMinutesWatched,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Duration',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewDuration,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Percentage',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewPercentage,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Gained',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersGained,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Lost',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersLost,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Likes',
        data: mappedData?.map((p: any) => ({
          total: p.likes,
          date: p.day,
        })),
      });

      return acc;
    } catch (err) {
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      // Fetch video statistics
      const response = await youtubeClient.videos.list({
        part: ['statistics', 'snippet'],
        id: [postId],
      });

      const video = response.data.items?.[0];

      if (!video || !video.statistics) {
        return [];
      }

      const stats = video.statistics;
      const result: AnalyticsData[] = [];

      if (stats.viewCount !== undefined) {
        result.push({
          label: 'Views',
          data: [{ total: String(stats.viewCount), date: today }],
        });
      }

      if (stats.likeCount !== undefined) {
        result.push({
          label: 'Likes',
          data: [{ total: String(stats.likeCount), date: today }],
        });
      }

      if (stats.commentCount !== undefined) {
        result.push({
          label: 'Comments',
          data: [{ total: String(stats.commentCount), date: today }],
        });
      }

      if (stats.favoriteCount !== undefined) {
        result.push({
          label: 'Favorites',
          data: [{ total: String(stats.favoriteCount), date: today }],
        });
      }

      return result;
    } catch (err) {
      console.error(
        'Error fetching YouTube post analytics:',
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
    _integration: Integration
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      const response = await youtubeClient.commentThreads.list({
        part: ['snippet', 'replies'],
        videoId: postId,
        maxResults: 50,
        pageToken: cursor,
      });

      const comments: SocialCommentDTO[] = (response.data.items || []).map(
        (item: any) => {
          const snippet = item.snippet?.topLevelComment?.snippet;
          return {
            platformCommentId: item.id,
            author: {
              id: snippet?.authorChannelId?.value || '',
              name: snippet?.authorDisplayName || '',
              username: snippet?.authorChannelUrl || '',
              picture: snippet?.authorProfileImageUrl || '',
            },
            content: snippet?.textOriginal || '',
            createdAt: snippet?.publishedAt || '',
            likeCount: snippet?.likeCount || 0,
            replyCount: item.snippet?.totalReplyCount || 0,
          };
        }
      );

      const nextCursor =
        response.data.nextPageToken || undefined;

      return { comments, nextCursor };
    } catch (err) {
      this.logger.error(
        `YouTube fetchComments error: ${(err as Error)?.message || 'unknown'}`
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
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      const response = await youtubeClient.comments.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            parentId: parentCommentId,
            textOriginal: message,
          },
        },
      });

      return {
        platformCommentId: response.data.id || '',
        parentPlatformCommentId: parentCommentId,
        author: {
          id: response.data.snippet?.authorChannelId?.value || '',
          name: response.data.snippet?.authorDisplayName || '',
          username: response.data.snippet?.authorChannelUrl || '',
          picture: response.data.snippet?.authorProfileImageUrl || '',
        },
        content: response.data.snippet?.textOriginal || '',
        createdAt: response.data.snippet?.publishedAt || '',
      };
    } catch (err) {
      this.logger.error(
        `YouTube replyToComment error: ${(err as Error)?.message || 'unknown'}`
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

const __adapter = new YoutubeProvider();

export const youtubeSocialModule: __ProviderModule<any, any> = {
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
