import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Rules } from '@gitroom/provider-kernel';
import { GmbSettingsDto } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';

// S-17 / known proxy gap: the googleapis SDK creates its own Gaxios/OAuth2 HTTP
// clients and does not expose a hook that accepts an undici Dispatcher. The
// per-channel VPN dispatcher returned by SocialAbstract.fetch() (via
// getVpnDispatcher()) therefore cannot be applied to GMB OAuth token calls or
// to oauth2/v2 API calls. SSRF protection is still present for fixed
// *.googleapis.com hosts via normal TCP routing; the gap is specifically
// per-channel VPN egress. Closing it would require a custom Gaxios
// adapter/fetchImplementation that translates GaxiosOptions into undici requests
// with the active dispatcher.
let _clientAndGmb: {
  client: OAuth2Client;
  oauth2: (newClient: OAuth2Client) => ReturnType<typeof google.oauth2>;
} | undefined;

const clientAndGmb = (clientId?: string, clientSecret?: string) => {
  const useClientId = clientId || '';
  const useClientSecret = clientSecret || '';

  if (!clientId && !clientSecret && _clientAndGmb) return _clientAndGmb;

  const client = new google.auth.OAuth2({
    clientId: useClientId,
    clientSecret: useClientSecret,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/gmb`,
  });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  if (!clientId && !clientSecret) {
    _clientAndGmb = { client, oauth2 };
  }

  return { client, oauth2 };
};

@Rules(
  'Google My Business posts can have text content and optionally one image. Posts can be updates, events, or offers.'
)
export class GmbProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3;
  identifier = 'gmb';
  name = 'Google My Business';
  isBetweenSteps = true;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/business.manage',
  ];
  editor = 'normal' as const;
  dto = GmbSettingsDto;

  maxLength() {
    return 1500;
  }

  override async checkValidity(
    items: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    // GMB posts can have text only, or text with one image
    if ((items?.length ?? 0) > 0 && (items?.[0]?.length ?? 0) > 1) {
      return 'Google My Business posts can only have one image';
    }

    // Check for video - GMB doesn't support video in local posts
    if ((items?.length ?? 0) > 0 && (items?.[0]?.length ?? 0) > 0) {
      const media = items?.[0]?.[0];
      if ((media?.path?.indexOf?.('mp4') ?? -1) > -1) {
        return 'Google My Business posts do not support video attachments';
      }
    }

    // Event posts require a title
    if (settings?.topicType === 'EVENT' && !settings?.eventTitle) {
      return 'Event posts require an event title';
    }

    return true;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('UNAUTHENTICATED') || body.includes('invalid_grant')) {
      return {
        type: 'refresh-token',
        value: 'Please re-authenticate your Google My Business account',
      };
    }

    if (body.includes('Unauthorized')) {
      return {
        type: 'refresh-token',
        value:
          'Token expired or invalid, please reconnect your Google My Business account.',
      };
    }

    if (body.includes('PERMISSION_DENIED')) {
      return {
        type: 'refresh-token',
        value:
          'Permission denied. Please ensure you have access to this business location.',
      };
    }

    if (body.includes('NOT_FOUND')) {
      return {
        type: 'bad-body',
        value: 'Business location not found. It may have been deleted.',
      };
    }

    if (body.includes('INVALID_ARGUMENT')) {
      return {
        type: 'bad-body',
        value: 'Invalid post content. Please check your post details.',
      };
    }

    if (body.includes('RESOURCE_EXHAUSTED')) {
      return {
        type: 'bad-body',
        value: 'Rate limit exceeded. Please try again later.',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndGmb(
      clientInformation?.client_id,
      clientInformation?.client_secret
    );
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new Error('Failed to refresh Google My Business access token');
    }
    if (!credentials.expiry_date) {
      throw new Error('Failed to get Google My Business token expiry date');
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
      refreshToken: credentials.refresh_token || refresh_token,
      id: String(data.id || ''),
      name: data.name || '',
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const { client } = clientAndGmb(
      clientInformation?.client_id,
      clientInformation?.client_secret
    );
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/gmb`,
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
    const { client, oauth2 } = clientAndGmb(
      clientInformation?.client_id,
      clientInformation?.client_secret
    );
    const { tokens } = await client.getToken(params.code);
    if (!tokens.access_token) {
      throw new Error('Failed to get Google My Business access token');
    }
    if (!tokens.expiry_date) {
      throw new Error('Failed to get Google My Business token expiry date');
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
    // Get all accounts with pagination
    const allAccounts: any[] = [];
    let accountsPageToken: string | undefined;

    do {
      const params = new URLSearchParams();
      if (accountsPageToken) {
        params.set('pageToken', accountsPageToken);
      }
      const url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts${params.toString() ? `?${params}` : ''}`;

      const accountsResponse = await this.fetch(
        url,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        'gmb list accounts'
      );
      const accountsData = await accountsResponse.json();

      if (accountsData.accounts) {
        allAccounts.push(...accountsData.accounts);
      }
      accountsPageToken = accountsData.nextPageToken;
    } while (accountsPageToken);

    if (allAccounts.length === 0) {
      return [];
    }

    // Get locations for each account
    const allLocations: Array<{
      id: string;
      name: string;
      picture: { data: { url: string } };
      accountName: string;
      locationName: string;
    }> = [];

    for (const account of allAccounts) {
      const accountName = account.name; // format: accounts/{accountId}

      try {
        // Get all locations with pagination
        let locationsPageToken: string | undefined;

        do {
          const params = new URLSearchParams({
            readMask: 'name,title,storefrontAddress,metadata',
          });
          if (locationsPageToken) {
            params.set('pageToken', locationsPageToken);
          }

          const locationsResponse = await this.fetch(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
            'gmb list locations'
          );
          const locationsData = await locationsResponse.json();

          if (locationsData.locations) {
            for (const location of locationsData.locations) {
              // location.name is in format: locations/{locationId}
              // We need the full path: accounts/{accountId}/locations/{locationId}
              const locationId = location.name.replace('locations/', '');
              const fullResourceName = `${accountName}/locations/${locationId}`;

              // Get profile photo if available
              let photoUrl = '';
              try {
                const mediaResponse = await this.fetch(
                  `https://mybusinessbusinessinformation.googleapis.com/v1/${location.name}/media`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  },
                  'gmb location media'
                );
                const mediaData = await mediaResponse.json();
                if (mediaData.mediaItems && mediaData.mediaItems.length > 0) {
                  const profilePhoto = mediaData.mediaItems.find(
                    (m: any) =>
                      m.mediaFormat === 'PHOTO' &&
                      m.locationAssociation?.category === 'PROFILE'
                  );
                  if (profilePhoto?.googleUrl) {
                    photoUrl = profilePhoto.googleUrl;
                  } else if (mediaData.mediaItems[0]?.googleUrl) {
                    photoUrl = mediaData.mediaItems[0].googleUrl;
                  }
                }
              } catch {
                // Ignore media fetch errors
              }

              allLocations.push({
                // id is the full resource path for the v4 API: accounts/{accountId}/locations/{locationId}
                id: fullResourceName,
                name: location.title || 'Unnamed Location',
                picture: { data: { url: photoUrl } },
                accountName: accountName,
                locationName: location.name,
              });
            }
          }
          locationsPageToken = locationsData.nextPageToken;
        } while (locationsPageToken);
      } catch (error) {
        // Continue with other accounts if one fails
        console.error(
          `Failed to fetch locations for account ${accountName}:`,
          (error as Error)?.message || 'unknown'
        );
      }
    }

    return allLocations;
  }

  async fetchPageInformation(
    accessToken: string,
    data: { id: string; accountName: string; locationName: string }
  ) {
    // data.id is the full resource path: accounts/{accountId}/locations/{locationId}
    // data.locationName is the v1 API format: locations/{locationId}
    // Fetch location details using the v1 API format
    const locationResponse = await this.fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${data.locationName}?readMask=name,title,storefrontAddress,metadata`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'gmb location details'
    );
    const locationData = await locationResponse.json();

    // Try to get profile photo
    let photoUrl = '';
    try {
      const mediaResponse = await this.fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${data.locationName}/media`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        'gmb location media'
      );
      const mediaData = await mediaResponse.json();
      if (mediaData.mediaItems && mediaData.mediaItems.length > 0) {
        const profilePhoto = mediaData.mediaItems.find(
          (m: any) =>
            m.mediaFormat === 'PHOTO' &&
            m.locationAssociation?.category === 'PROFILE'
        );
        if (profilePhoto?.googleUrl) {
          photoUrl = profilePhoto.googleUrl;
        } else if (mediaData.mediaItems[0]?.googleUrl) {
          photoUrl = mediaData.mediaItems[0].googleUrl;
        }
      }
    } catch {
      // Ignore media fetch errors
    }

    return {
      // Return the full resource path as id (for v4 Local Posts API)
      id: data.id,
      name: locationData.title || 'Unnamed Location',
      access_token: accessToken,
      picture: photoUrl,
      username: '',
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const pages = await this.pages(accessToken);
    const findPage = pages.find((p) => p.id === requiredId);

    if (!findPage) {
      throw new Error('Location not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      accountName: findPage.accountName,
      locationName: findPage.locationName,
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
    postDetails: PostDetails<GmbSettingsDto>[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const { settings } = firstPost;

    // Build the local post request body
    const postBody: any = {
      languageCode: 'en',
      summary: firstPost.message,
      topicType: settings?.topicType || 'STANDARD',
    };

    // Add call to action if provided (and not NONE)
    if (
      settings?.callToActionType &&
      settings.callToActionType !== 'NONE' &&
      settings?.callToActionUrl
    ) {
      postBody.callToAction = {
        actionType: settings.callToActionType,
        url: settings.callToActionUrl,
      };
    }

    // Add media if provided
    if (firstPost.media && firstPost.media.length > 0) {
      const mediaItem = firstPost.media[0];
      postBody.media = [
        {
          mediaFormat: mediaItem.type === 'video' ? 'VIDEO' : 'PHOTO',
          sourceUrl: mediaItem.path,
        },
      ];
    }

    // Add event details if it's an event post
    if (settings?.topicType === 'EVENT' && settings?.eventTitle) {
      postBody.event = {
        title: settings.eventTitle,
        schedule: {
          startDate: this.formatDate(settings.eventStartDate),
          endDate: this.formatDate(settings.eventEndDate),
          ...(settings.eventStartTime && {
            startTime: this.formatTime(settings.eventStartTime),
          }),
          ...(settings.eventEndTime && {
            endTime: this.formatTime(settings.eventEndTime),
          }),
        },
      };
    }

    // Add offer details if it's an offer post
    if (settings?.topicType === 'OFFER') {
      postBody.offer = {
        couponCode: settings?.offerCouponCode || undefined,
        redeemOnlineUrl: settings?.offerRedeemUrl || undefined,
        termsConditions: settings?.offerTerms || undefined,
      };
    }

    // Create the local post
    const response = await this.fetch(
      `https://mybusiness.googleapis.com/v4/${id}/localPosts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postBody),
      },
      'create local post'
    );

    const postData = await response.json();

    // Extract the post ID and construct the URL
    const postId = postData.name || '';
    const locationId = id.split('/').pop();

    // GMB posts don't have direct URLs, but we can link to the business profile
    const releaseURL = `https://business.google.com/locations/${locationId}`;

    return [
      {
        id: firstPost.id,
        postId: postId,
        releaseURL: releaseURL,
        status: 'success',
      },
    ];
  }

  private formatDate(dateString?: string): any {
    if (!dateString) {
      return {
        year: dayjs().year(),
        month: dayjs().month() + 1,
        day: dayjs().date(),
      };
    }
    const date = dayjs(dateString);
    return {
      year: date.year(),
      month: date.month() + 1,
      day: date.date(),
    };
  }

  private formatTime(timeString?: string): any {
    if (!timeString) {
      return undefined;
    }
    const [hours, minutes] = timeString.split(':').map(Number);
    return {
      hours: hours || 0,
      minutes: minutes || 0,
      seconds: 0,
      nanos: 0,
    };
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(date, 'day').format('YYYY-MM-DD');

      // id is in format: accounts/{accountId}/locations/{locationId}
      // Business Profile Performance API expects: locations/{locationId}
      const locationId = id.split('/locations/')[1];
      const locationPath = `locations/${locationId}`;

      // Use the Business Profile Performance API
      const response = await this.fetch(
        `https://businessprofileperformance.googleapis.com/v1/${locationPath}:fetchMultiDailyMetricsTimeSeries?dailyMetrics=WEBSITE_CLICKS&dailyMetrics=CALL_CLICKS&dailyMetrics=BUSINESS_DIRECTION_REQUESTS&dailyMetrics=BUSINESS_IMPRESSIONS_DESKTOP_MAPS&dailyMetrics=BUSINESS_IMPRESSIONS_MOBILE_MAPS&dailyRange.startDate.year=${dayjs(
          startDate
        ).year()}&dailyRange.startDate.month=${
          dayjs(startDate).month() + 1
        }&dailyRange.startDate.day=${dayjs(
          startDate
        ).date()}&dailyRange.endDate.year=${dayjs(
          endDate
        ).year()}&dailyRange.endDate.month=${
          dayjs(endDate).month() + 1
        }&dailyRange.endDate.day=${dayjs(endDate).date()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        'gmb analytics'
      );

      const data = await response.json();

      // Response structure: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [...] }] }
      const dailyMetricTimeSeries =
        data.multiDailyMetricTimeSeries?.[0]?.dailyMetricTimeSeries;

      if (!dailyMetricTimeSeries || dailyMetricTimeSeries.length === 0) {
        return [];
      }

      const metricLabels: { [key: string]: string } = {
        WEBSITE_CLICKS: 'Website Clicks',
        CALL_CLICKS: 'Phone Calls',
        BUSINESS_DIRECTION_REQUESTS: 'Direction Requests',
        BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'Desktop Map Views',
        BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'Mobile Map Views',
      };

      const analytics: AnalyticsData[] = [];

      for (const series of dailyMetricTimeSeries) {
        const metricName = series.dailyMetric;
        const label = metricLabels[metricName] || metricName;

        const datedValues = series.timeSeries?.datedValues || [];

        const dataPoints = datedValues.map((dv: any) => ({
          total: parseInt(dv.value || '0', 10),
          date: `${dv.date.year}-${String(dv.date.month).padStart(
            2,
            '0'
          )}-${String(dv.date.day).padStart(2, '0')}`,
        }));

        if (dataPoints.length > 0) {
          analytics.push({
            label,
            data: dataPoints,
          });
        }
      }

      return analytics;
    } catch (error) {
      console.error(
        'Error fetching GMB analytics:',
        (error as Error)?.message || 'unknown'
      );
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Google My Business local posts don't have detailed individual post analytics
    // The API focuses on location-level metrics rather than post-level metrics
    return [];
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new GmbProvider();

export const gmbSocialModule: __ProviderModule<any, any> = {
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
