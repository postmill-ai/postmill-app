import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { LemmySettingsDto } from '@gitroom/provider-kernel';
import { Tool } from '@gitroom/provider-kernel';
import { safeFetch } from '@gitroom/provider-kernel';
import { Logger } from '@nestjs/common';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// S-11: validate callback service URL before interpolating it into API calls.
function validateLemmyService(value: unknown): { ok: true; base: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Invalid service URL' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'Invalid service URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Service URL must use HTTPS' };
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost') {
    return { ok: false, error: 'Invalid hostname' };
  }
  // Reject literal private/loopback IPs. Public hostnames are still protected by
  // the SSRF dispatcher at connect time.
  if (net.isIP(hostname)) {
    return { ok: false, error: 'IP addresses are not allowed' };
  }
  const base = url.toString().replace(/\/$/, '');
  return { ok: true, base };
}

function assertLemmyBody(body: unknown): { service: string; identifier: string; password: string } {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid credentials');
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.service !== 'string' ||
    typeof record.identifier !== 'string' ||
    typeof record.password !== 'string' ||
    !record.service.trim() ||
    !record.identifier.trim() ||
    !record.password.trim()
  ) {
    throw new Error('Invalid credentials');
  }
  const validation = validateLemmyService(record.service);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    service: validation.base,
    identifier: record.identifier,
    password: record.password,
  };
}

function parseLemmyCallback(token: string): { service: string; identifier: string; password: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid credentials');
  }
  return assertLemmyBody(parsed);
}
export class LemmyProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(LemmyProvider.name);
  override maxConcurrentJob = 3; // Lemmy instances typically have moderate limits
  identifier = 'lemmy';
  name = 'Lemmy';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  maxLength() {
    return 10000;
  }
  dto = LemmySettingsDto;

  override async checkValidity(
    items: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const [firstItems] = items ?? [];
    if (
      firstItems?.length &&
      (firstItems?.[0]?.path?.indexOf?.('png') ?? -1) === -1 &&
      (firstItems?.[0]?.path?.indexOf?.('jpg') ?? -1) === -1 &&
      (firstItems?.[0]?.path?.indexOf?.('jpef') ?? -1) === -1 &&
      (firstItems?.[0]?.path?.indexOf?.('gif') ?? -1) === -1
    ) {
      return 'You can set only one picture for a cover';
    }
    return true;
  }

  async customFields() {
    return [
      {
        key: 'service',
        label: 'Service',
        defaultValue: 'https://lemmy.world',
        validation: `/^https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)$/`,
        type: 'text' as const,
      },
      {
        key: 'identifier',
        label: 'Identifier',
        validation: `/^.{3,}$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
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

  async generateAuthUrl() {
    const state = makeOauthState();
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let body: { service: string; identifier: string; password: string };
    try {
      body = parseLemmyCallback(params.code);
    } catch (err) {
      this.logger.warn('Lemmy callback validation failed');
      return 'Invalid credentials';
    }

    const load = await safeFetch(body.service + '/api/v3/user/login', {
      body: JSON.stringify({
        username_or_email: body.identifier,
        password: body.password,
      }),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (load.status === 401) {
      return 'Invalid credentials';
    }

    const { jwt } = await load.json();

    try {
      const user = await (
        await safeFetch(body.service + `/api/v3/user?username=${body.identifier}`, {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        })
      ).json();

      return {
        refreshToken: jwt!,
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: jwt!,
        id: String(user.person_view.person.id),
        name:
          user.person_view.person.display_name ||
          user.person_view.person.name ||
          '',
        picture: user?.person_view?.person?.avatar || '',
        username: body.identifier || '',
      };
    } catch (e) {
      this.logger.warn('Lemmy authentication failed');
      return 'Invalid credentials';
    }
  }

  private async getJwtAndService(integration: Integration): Promise<{ jwt: string; service: string }> {
    const stored = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    const body = assertLemmyBody(stored);

    const { jwt } = await (
      await safeFetch(body.service + '/api/v3/user/login', {
        body: JSON.stringify({
          username_or_email: body.identifier,
          password: body.password,
        }),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
    ).json();

    return { jwt, service: body.service };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<LemmySettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const { jwt, service } = await this.getJwtAndService(integration);

    const valueArray: PostResponse[] = [];

    for (const lemmy of firstPost.settings.subreddit) {
      const { post_view } = await (
        await safeFetch(service + '/api/v3/post', {
          body: JSON.stringify({
            community_id: +lemmy.value.id,
            name: lemmy.value.title,
            body: firstPost.message,
            ...(lemmy.value.url
              ? {
                  url:
                    lemmy.value.url.indexOf('http') === -1
                      ? `https://${lemmy.value.url}`
                      : lemmy.value.url,
                }
              : {}),
            ...(firstPost.media?.length
              ? { custom_thumbnail: firstPost.media[0].path }
              : {}),
            nsfw: false,
          }),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
        })
      ).json();

      valueArray.push({
        postId: post_view.post.id,
        releaseURL: service + '/post/' + post_view.post.id,
        id: firstPost.id,
        status: 'published',
      });
    }

    return [
      {
        id: firstPost.id,
        postId: valueArray.map((p) => String(p.postId)).join(','),
        releaseURL: valueArray.map((p) => p.releaseURL).join(','),
        status: 'published',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<LemmySettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const { jwt, service } = await this.getJwtAndService(integration);

    // postId can be comma-separated if posted to multiple communities
    const postIds = postId.split(',');
    const valueArray: PostResponse[] = [];

    for (const singlePostId of postIds) {
      const { comment_view } = await (
        await safeFetch(service + '/api/v3/comment', {
          body: JSON.stringify({
            post_id: +singlePostId,
            content: commentPost.message,
          }),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
        })
      ).json();

      valueArray.push({
        postId: String(comment_view.comment.id),
        releaseURL: service + '/comment/' + comment_view.comment.id,
        id: commentPost.id,
        status: 'published',
      });
    }

    return [
      {
        id: commentPost.id,
        postId: valueArray.map((p) => p.postId).join(','),
        releaseURL: valueArray.map((p) => p.releaseURL).join(','),
        status: 'published',
      },
    ];
  }

  @Tool({
    description: 'Search for Lemmy communities by keyword',
    dataSchema: [
      {
        key: 'word',
        type: 'string',
        description: 'Keyword to search for',
      },
    ],
  })
  async subreddits(
    accessToken: string,
    data: any,
    id: string,
    integration: Integration
  ) {
    const { jwt, service } = await this.getJwtAndService(integration);

    const { communities } = await (
      await safeFetch(
        service + `/api/v3/search?type_=Communities&sort=Active&q=${data.word}`,
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        }
      )
    ).json();

    return communities.map((p: any) => ({
      title: p.community.title,
      name: p.community.title,
      id: p.community.id,
    }));
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new LemmyProvider();

export const lemmySocialModule: __ProviderModule<any, any> = {
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
