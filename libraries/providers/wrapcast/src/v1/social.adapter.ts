import {
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { Integration } from '@prisma/client';
import { FarcasterDto } from '@gitroom/provider-kernel';
import { Tool } from '@gitroom/provider-kernel';
import { Rules } from '@gitroom/provider-kernel';

import { socialMetadata as providerMetadata } from './metadata';
@Rules(
  'Farcaster/Warpcast can only accept pictures'
)
export class FarcasterProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'wrapcast';
  name = 'Farcaster';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  override maxConcurrentJob = 3; // Farcaster has moderate limits
  editor = 'normal' as const;

  private getClient(apiKey: string): NeynarAPIClient {
    return new NeynarAPIClient({
      apiKey: apiKey || '00000000-000-0000-000-000000000000',
    });
  }
  maxLength() {
    return 800;
  }
  dto = FarcasterDto;

  override async checkValidity(
    list: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (
      list?.some((item) =>
        item?.some((field) => (field?.path?.indexOf?.('mp4') ?? -1) > -1)
      )
    ) {
      return 'Can only accept images';
    }
    return true;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
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
    return {
      url: `${clientInformation?.client_id || ''}||${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let data: {
      fid: number | string;
      display_name: string;
      signer_uuid: string;
      username: string;
      pfp_url?: string;
    };
    try {
      const parsed = JSON.parse(Buffer.from(params.code, 'base64').toString());
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.fid === undefined ||
        parsed.fid === null ||
        typeof parsed.display_name !== 'string' ||
        typeof parsed.signer_uuid !== 'string' ||
        typeof parsed.username !== 'string' ||
        !parsed.signer_uuid.trim() ||
        !parsed.username.trim()
      ) {
        throw new Error('Invalid callback');
      }
      data = parsed;
    } catch (err) {
      return 'Invalid credentials';
    }
    return {
      id: String(data.fid),
      name: data.display_name,
      accessToken: data.signer_uuid,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: data?.pfp_url || '',
      username: data.username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FarcasterDto>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const ids: { releaseURL: string; postId: string }[] = [];

    const channels =
      !firstPost?.settings?.subreddit ||
      firstPost?.settings?.subreddit.length === 0
        ? [undefined]
        : firstPost?.settings?.subreddit;

    for (const channel of channels) {
      const data = await this.getClient(clientInformation?.client_secret || '').publishCast({
        embeds: (firstPost?.media?.map((media) => ({
          url: media.path,
        })) || []) as any,
        signerUuid: accessToken,
        text: firstPost.message,
        ...(channel?.value?.id ? { channelId: channel?.value?.id } : {}),
      });

      ids.push({
        // @ts-ignore
        releaseURL: `https://warpcast.com/${data.cast.author.username}/${data.cast.hash}`,
        postId: data.cast.hash,
      });
    }

    return [
      {
        id: firstPost.id,
        postId: ids.map((p) => p.postId).join(','),
        releaseURL: ids.map((p) => p.releaseURL).join(','),
        status: 'published',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<FarcasterDto>[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const ids: { releaseURL: string; postId: string }[] = [];

    // postId can be comma-separated if posted to multiple channels
    const parentIds = (lastCommentId || postId).split(',');

    for (const parentHash of parentIds) {
      const data = await this.getClient(clientInformation?.client_secret || '').publishCast({
        embeds: (commentPost?.media?.map((media) => ({
          url: media.path,
        })) || []) as any,
        signerUuid: accessToken,
        text: commentPost.message,
        parent: parentHash,
      });

      ids.push({
        // @ts-ignore
        releaseURL: `https://warpcast.com/${data.cast.author.username}/${data.cast.hash}`,
        postId: data.cast.hash,
      });
    }

    return [
      {
        id: commentPost.id,
        postId: ids.map((p) => p.postId).join(','),
        releaseURL: ids.map((p) => p.releaseURL).join(','),
        status: 'published',
      },
    ];
  }

  @Tool({
    description: 'Search channels',
    dataSchema: [{ key: 'word', type: 'string', description: 'Search word' }],
  })
  async subreddits(
    accessToken: string,
    data: any,
    id: string,
    integration: Integration
  ) {
    const search = await this.getClient(integration.organizationId).searchChannels({
      q: data.word,
      limit: 10,
    });

    return search.channels.map((p) => {
      return {
        title: p.name,
        name: p.name,
        id: p.id,
      };
    });
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new FarcasterProvider();

export const wrapcastSocialModule: __ProviderModule<any, any> = {
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
