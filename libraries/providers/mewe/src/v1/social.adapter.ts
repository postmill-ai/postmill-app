import {
  AuthTokenDetails,
  ChannelSetupDescriptor,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postmill-ai/provider-kernel';
import { makeId, makeOauthState } from '@postmill-ai/provider-kernel';
import { SocialAbstract } from '@postmill-ai/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { MeweDto } from '@postmill-ai/provider-kernel';
import { Tool } from '@postmill-ai/provider-kernel';
import { hasExtension } from '@postmill-ai/helpers/utils/has.extension';
import { getOrgCredential } from '@postmill-ai/provider-kernel';
import { Logger } from '@nestjs/common';
import { safeFetch } from '@postmill-ai/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class MeweProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(MeweProvider.name);
  identifier = 'mewe';
  name = 'MeWe';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  dto = MeweDto;

  // Beginner-friendly setup metadata for the per-tenant "Add channel" form.
  // MeWe hands out API access per developer application (App ID + API Key) and
  // the connect flow redirects to {instance}/login with a redirect_uri, so the
  // callback must be registered on the app. The default callback URL is
  // computed by the catalog (IntegrationManager.getSocialProviderCatalog) —
  // do NOT hardcode it here.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'oauth2',
    credentialFields: [
      {
        key: 'clientId',
        label: 'App ID',
        help: 'MeWe Developer Portal → your application',
      },
      {
        key: 'clientSecret',
        label: 'API Key',
        secret: true,
        help: 'MeWe Developer Portal → your application',
      },
    ],
    portalUrl: 'https://dev.mewe.com',
    portalLabel: 'MeWe Developer Portal',
    callbackInstructions:
      'In the MeWe Developer Portal → your application: add this URL as an allowed redirect/callback URL and save.',
    setupSteps: [
      'Sign in to MeWe and request a developer account on the MeWe Developer Portal (approval is manual).',
      'Once approved, create an application in the portal.',
      'Add the callback URL shown below to the application’s allowed redirect URLs.',
      'Copy the application’s App ID and API Key into the fields below.',
    ],
  };

  private _resolveBaseUrl(instanceUrl?: string): string {
    let base = (instanceUrl || 'https://mewe.com').trim();
    let end = base.length;
    while (end > 0 && base.charCodeAt(end - 1) === 47 /* '/' */) {
      end--;
    }
    base = base.slice(0, end);
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error(
        `Invalid MeWe instance URL: "${base}" is not a valid URL.`
      );
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(
        `Invalid MeWe instance URL: "${base}" must use HTTPS.`
      );
    }
    if (!parsed.hostname) {
      throw new Error(
        `Invalid MeWe instance URL: "${base}" has no hostname.`
      );
    }
    return base;
  }

  private authHeaders(apiToken: string, appId: string, apiKey: string) {
    return {
      'X-App-Id': appId,
      'X-Api-Key': apiKey,
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  maxLength() {
    return 63206;
  }

  private readonly maxGroupPages = 100;

  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.indexOf('Unauthorized') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token expired, please re-authenticate',
      };
    }

    if (body.indexOf('Enhance Your Calm') > -1 || body.indexOf('420') > -1) {
      return {
        type: 'retry' as const,
        value: 'Rate limited, retrying...',
      };
    }

    if (body.indexOf('Forbidden') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Insufficient permissions for this action',
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

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const instanceUrl = this._resolveBaseUrl(clientInformation?.instanceUrl);
    return {
      url:
        `${instanceUrl}/login` +
        `?client_id=${clientInformation?.client_id || ''}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/mewe`
        )}` +
        `&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }, clientInformation?: ClientInformation) {
    const loginRequestToken = params.code;
    const appId = clientInformation?.client_id || '';
    const apiKey = clientInformation?.client_secret || '';
    const instanceUrl = this._resolveBaseUrl(clientInformation?.instanceUrl);

    if (!loginRequestToken) {
      return 'No login request token received. Please try again.';
    }

    try {
      // Exchange loginRequestToken for apiToken
      const tokenResponse = await this.fetch(
        `${instanceUrl}/api/dev/token?loginRequestToken=${loginRequestToken}`,
        {
          method: 'GET',
          headers: {
            'X-App-Id': appId,
            'X-Api-Key': apiKey,
          },
        },
        'mewe-token'
      );

      if (!tokenResponse.ok) {
        return 'Failed to exchange token. Please try again.';
      }

      const tokenData = await tokenResponse.json();

      if (tokenData.pending) {
        return 'Login request is still pending. Please approve on MeWe and try again.';
      }

      if (!tokenData.apiToken) {
        return 'No API token received. Please try again.';
      }

      const apiToken = tokenData.apiToken;
      const expiresAt = tokenData.expiresAt;

      // Fetch user profile
      const profileResponse = await this.fetch(`${instanceUrl}/api/dev/me`, {
        method: 'GET',
        headers: this.authHeaders(apiToken, appId, apiKey),
      }, 'mewe-profile');

      if (!profileResponse.ok) {
        return 'Failed to fetch MeWe profile.';
      }

      const profile = await profileResponse.json();

      const expiresIn = expiresAt
        ? dayjs(expiresAt).unix() - dayjs().unix()
        : dayjs().add(30, 'days').unix() - dayjs().unix();

      return {
        id: profile.userId,
        name:
          profile.name ||
          `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
        accessToken: apiToken,
        refreshToken: '',
        expiresIn,
        picture: '',
        username: profile.handle || '',
      };
    } catch (e) {
      this.logger.warn('MeWe authentication failed');
      return 'MeWe authentication failed. Please try again.';
    }
  }

  @Tool({ description: 'Groups', dataSchema: [] })
  async groups(
    accessToken: string,
    params: any,
    id: string,
    integration: Integration
  ) {
    try {
      const appId = getOrgCredential(integration.organizationId, 'mewe', 'clientId') || '';
      const apiKey = getOrgCredential(integration.organizationId, 'mewe', 'clientSecret') || '';
      const instanceUrl = this._resolveBaseUrl(
        getOrgCredential(integration.organizationId, 'mewe', 'redirectUri')
      );
      const instanceOrigin = new URL(instanceUrl).origin;
      const allGroups: any[] = [];
      let nextUrl: string | null = `${instanceUrl}/api/dev/groups`;
      let pages = 0;

      while (nextUrl && pages < this.maxGroupPages) {
        pages += 1;
        const response = await this.fetch(
          nextUrl,
          {
            method: 'GET',
            headers: this.authHeaders(accessToken, appId, apiKey),
          },
          'mewe-groups'
        );

        const data = await response.json();
        allGroups.push(...(data.groups || []));
        if (data.nextPage) {
          const candidate = new URL(data.nextPage, instanceUrl).toString();
          const candidateOrigin = new URL(candidate).origin;
          nextUrl = candidateOrigin === instanceOrigin ? candidate : null;
        } else {
          nextUrl = null;
        }
      }

      return allGroups.map((group: any) => ({
        id: String(group.groupId),
        name: group.name,
      }));
    } catch (err) {
      return [];
    }
  }

  private async uploadPhoto(
    accessToken: string,
    mediaPath: string,
    appId: string,
    apiKey: string,
    instanceUrl: string
  ): Promise<string> {
    const mediaResponse = await safeFetch(mediaPath);
    const blob = await mediaResponse.blob();
    const fileName = mediaPath.split('/').pop() || 'photo.jpg';

    const form = new FormData();
    form.append('file', blob, fileName);

    const uploadResponse = await this.fetch(
      `${instanceUrl}/api/dev/photo/upload`,
      {
        method: 'POST',
        headers: {
          'X-App-Id': appId,
          'X-Api-Key': apiKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      },
      'mewe-photo-upload'
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Photo upload failed: ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    return uploadData.id;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<MeweDto>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const postType = firstPost.settings.postType || 'group';
    const groupId = firstPost.settings.group;
    const appId = clientInformation?.client_id || '';
    const apiKey = clientInformation?.client_secret || '';
    const instanceUrl = this._resolveBaseUrl(clientInformation?.instanceUrl);

    // Upload photos if present (exclude videos)
    const imageMedia =
      firstPost.media?.filter((m) => !m.path || !hasExtension(m.path, 'mp4')) ||
      [];

    const uploadedPhotoIds: string[] = [];
    for (const media of imageMedia) {
      const photoId = await this.uploadPhoto(accessToken, media.path, appId, apiKey, instanceUrl);
      uploadedPhotoIds.push(photoId);
    }

    const postBody: Record<string, any> = { text: firstPost.message };
    if (uploadedPhotoIds.length > 0) {
      postBody.uploadedPhotoIds = uploadedPhotoIds;
    }

    const postUrl =
      postType === 'timeline'
        ? `${instanceUrl}/api/dev/me/post`
        : `${instanceUrl}/api/dev/group/${encodeURIComponent(groupId)}/post`;

    // MeWe post endpoint may return 204 (no content); this.fetch handles SSRF/VPN.
    const postResponse = await this.fetch(postUrl, {
      method: 'POST',
      headers: this.authHeaders(accessToken, appId, apiKey),
      body: JSON.stringify(postBody),
    }, 'mewe-post');

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      const handleError = this.handleErrors(errorText);
      if (handleError) {
        throw new Error(handleError.value);
      }
      throw new Error('Failed to create MeWe post');
    }

    const postId = makeId(12);

    const releaseURL =
      postType === 'timeline'
        ? `https://mewe.com/${encodeURIComponent(integration.profile || '')}/posts`
        : `https://mewe.com/group/${encodeURIComponent(firstPost.settings.group || '')}`;

    return [
      {
        id: firstPost.id,
        postId,
        releaseURL,
        status: 'success',
      },
    ];
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

const __adapter = new MeweProvider();

export const meweSocialModule: __ProviderModule<any, any> = {
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
