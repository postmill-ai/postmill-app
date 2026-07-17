import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import {
  safeFetch,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import { DribbbleDto } from '@gitroom/provider-kernel';
import mime from 'mime-types';
import { Tool } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class DribbbleProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Dribbble has moderate API limits
  identifier = 'dribbble';
  name = 'Dribbble';
  isBetweenSteps = false;
  scopes = ['public', 'upload'];
  editor = 'normal' as const;
  maxLength() {
    return 40000;
  }
  dto = DribbbleDto;

  override async checkValidity(
    [firstItem]: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const isMp4 = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) > -1
    );
    if (firstItem?.length !== 1) {
      return 'Requires one item';
    }
    if (isMp4) {
      return 'Does not support mp4 files';
    }
    const details = await this.getImageDimensions(firstItem?.[0]?.path);
    if (
      (details?.width === 400 && details?.height === 300) ||
      (details?.width === 800 && details?.height === 600)
    ) {
      return true;
    }
    return 'Invalid image size. Requires 400x300 or 800x600 px images.';
  }

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const { access_token, expires_in } = await (
      await this.fetch('https://dribbble.com/oauth/token', {
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
          scope: `${this.scopes.join(',')}`,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/dribbble`,
        }),
      })
    ).json();

    const { id, profile_image, username } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name: username,
      accessToken: access_token,
      refreshToken: refreshToken,
      expiresIn: expires_in,
      picture: profile_image || '',
      username,
    };
  }

  @Tool({ description: 'Teams list', dataSchema: [] })
  async teams(accessToken: string) {
    const { teams } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return (
      teams?.map((team: any) => ({
        id: team.id,
        name: team.name,
      })) || []
    );
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    return {
      url: `https://dribbble.com/oauth/authorize?client_id=${
        clientInformation?.client_id || ''
      }&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/dribbble`
      )}&response_type=code&scope=${this.scopes.join('+')}&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh: string;
    },
    clientInformation?: ClientInformation
  ) {
    const { access_token, scope } = await (
      await this.fetch('https://dribbble.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientInformation?.client_id || '',
          client_secret: clientInformation?.client_secret || '',
          code: params.code,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/dribbble`,
        }).toString(),
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const { id, name, avatar_url, login } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name,
      accessToken: access_token,
      refreshToken: '',
      expiresIn: 999999999,
      picture: avatar_url,
      username: login,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<DribbbleDto>[]
  ): Promise<PostResponse[]> {
    const mediaPath = postDetails?.[0]?.media?.[0]?.path;
    const mediaResponse = await safeFetch(mediaPath);
    if (!mediaResponse.ok) {
      throw new Error(
        `Failed to download media for Dribbble upload (status ${mediaResponse.status})`
      );
    }
    const arrayBuffer = await mediaResponse.arrayBuffer();

    const slash = mediaPath.split('/').at(-1);

    const blob = new Blob([arrayBuffer], {
      type: mime.lookup(slash!) || 'application/octet-stream',
    });

    const formData = new FormData();
    formData.append('image', blob, slash);
    formData.append('title', postDetails[0].settings.title);
    formData.append('description', postDetails[0].message);

    const data2 = await this.fetch('https://api.dribbble.com/v2/shots', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });

    const location = data2.headers.get('location');
    const newId = location?.split('/').at(-1);

    return [
      {
        id: postDetails?.[0]?.id,
        status: 'completed',
        postId: newId,
        releaseURL: `https://dribbble.com/shots/${newId}`,
      },
    ];
  }

  analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    return Promise.resolve([]);
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Dribbble doesn't provide detailed post-level analytics via their API
    return [];
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new DribbbleProvider();

export const dribbbleSocialModule: __ProviderModule<any, any> = {
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
