import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { WordpressDto } from '@gitroom/provider-kernel';
import slugify from 'slugify';
// import FormData from 'form-data';
import { Tool } from '@gitroom/provider-kernel';
import { safeFetch } from '@gitroom/provider-kernel';
import { Logger } from '@nestjs/common';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// S-10: validate callback URL before interpolating it into API calls.
function validatePublicHttpsUrl(value: unknown): { ok: true; base: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Invalid URL' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'URL must use HTTPS' };
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost') {
    return { ok: false, error: 'Invalid hostname' };
  }
  // Reject literal private/loopback IPs. Public hostnames resolve through normal
  // DNS and are still protected by the SSRF dispatcher at connect time.
  const ipVersion = net.isIP(hostname);
  if (ipVersion) {
    return { ok: false, error: 'IP addresses are not allowed' };
  }
  // Normalize base URL by stripping a trailing slash so paths don't double up.
  const base = url.toString().replace(/\/$/, '');
  return { ok: true, base };
}

function parseWordPressCallback(token: string): { domain: string; username: string; password: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid credentials');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid credentials');
  }
  const body = parsed as Record<string, unknown>;
  if (
    typeof body.domain !== 'string' ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string' ||
    !body.domain.trim() ||
    !body.username.trim() ||
    !body.password.trim()
  ) {
    throw new Error('Invalid credentials');
  }
  const validation = validatePublicHttpsUrl(body.domain);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    domain: validation.base,
    username: body.username,
    password: body.password,
  };
}
export class WordpressProvider
  extends SocialAbstract
  implements SocialProvider
{
  private readonly logger = new Logger(WordpressProvider.name);
  identifier = 'wordpress';
  name = 'WordPress';
  isBetweenSteps = false;
  editor = 'html' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 5; // WordPress self-hosted typically has generous limits
  dto = WordpressDto;
  maxLength() {
    return 100000;
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
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
  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.indexOf('rest_cannot_create') > -1) {
      return {
        type: 'bad-body',
        value: 'The connect user has insufficient permissions to create posts',
      };
    }
    return undefined;
  }

  async customFields() {
    return [
      {
        key: 'domain',
        label: 'Domain URL',
        validation: `/^https?:\\/\\/(?:www\\.)?[\\w\\-]+(\\.[\\w\\-]+)+([\\/?#][^\\s]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'username',
        label: 'Username',
        validation: `/.+/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/.+/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let body: { domain: string; username: string; password: string };
    try {
      body = parseWordPressCallback(params.code);
    } catch (err) {
      this.logger.warn('WordPress callback validation failed');
      return 'Invalid credentials';
    }
    try {
      const auth = Buffer.from(`${body.username}:${body.password}`).toString(
        'base64'
      );
      const { id, name, avatar_urls, code } = await (
        await safeFetch(`${body.domain}/wp-json/wp/v2/users/me`, {
          headers: {
            Authorization: `Basic ${auth}`,
          },
        })
      ).json();

      if (code) {
        throw "Invalid credentials";
      }

      const biggestImage = Object.entries(avatar_urls || {}).reduce(
        (all, current) => {
          if (all > Number(current[0])) {
            return all;
          }
          return Number(current[0]);
        },
        0
      );

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: params.code,
        id: body.domain + '_' + id,
        name,
        picture: avatar_urls?.[String(biggestImage)] || '',
        username: body.username,
      };
    } catch (err) {
      this.logger.warn('WordPress authentication failed');
      return 'Invalid credentials';
    }
  }

  @Tool({
    description: 'Get list of post types',
    dataSchema: [],
  })
  async postTypes(token: string) {
    const body = parseWordPressCallback(token);

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    const postTypes = await (
      await this.fetch(`${body.domain}/wp-json/wp/v2/types`, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      })
    ).json();

    return Object.entries<any>(postTypes).reduce((all, [key, value]) => {
      if (
        key.indexOf('wp_') > -1 ||
        key.indexOf('nav_') > -1 ||
        key === 'attachment'
      ) {
        return all;
      }

      all.push({
        id: value.rest_base,
        name: value.name,
      });

      return all;
    }, []);
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
      const body = parseWordPressCallback(accessToken);
      const auth = Buffer.from(`${body.username}:${body.password}`).toString('base64');

      let url = `${body.domain}/wp-json/wp/v2/comments?post=${postId}&per_page=50&orderby=date&order=asc`;
      if (cursor) {
        url += `&page=${cursor}`;
      }

      const response = await this.fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });
      const data = await response.json() as any[];

      const comments: SocialCommentDTO[] = (data || []).map((c: any) => ({
        platformCommentId: String(c.id),
        parentPlatformCommentId: c.parent ? String(c.parent) : undefined,
        author: {
          id: String(c.author_name),
          name: c.author_name || '',
          username: c.author_name,
          picture: c.author_avatar_urls?.['96'],
        },
        content: c.content?.rendered || '',
        createdAt: c.date,
        raw: c,
      }));

      const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1', 10);
      const currentPage = cursor ? parseInt(cursor, 10) : 1;
      const nextCursor = currentPage < totalPages ? String(currentPage + 1) : undefined;

      return { comments, nextCursor };
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
      const body = parseWordPressCallback(accessToken);
      const auth = Buffer.from(`${body.username}:${body.password}`).toString('base64');

      const response = await this.fetch(`${body.domain}/wp-json/wp/v2/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post: parseInt(postId, 10),
          parent: parseInt(parentCommentId, 10),
          content: message,
        }),
      });
      const data = await response.json() as any;

      return {
        platformCommentId: String(data.id),
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

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<WordpressDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const body = parseWordPressCallback(accessToken);

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    let mediaId = '';
    if (postDetails?.[0]?.settings?.main_image?.path) {
      this.logger.log('Uploading image to WordPress');

      const blob = await this.fetch(
        postDetails[0].settings.main_image.path
      ).then((r) => r.blob());

      const mediaResponse = await (
        await this.fetch(`${body.domain}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Disposition': `attachment; filename="${postDetails[0].settings.main_image.path
              .split('/')
              .pop()}"`,
            'Content-Type': blob.type,
          },
          body: blob,
        })
      ).json();

      mediaId = mediaResponse.id;
    }

    const submit = await (
      await this.fetch(
        `${body.domain}/wp-json/wp/v2/${postDetails?.[0]?.settings?.type}`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({
            title: postDetails?.[0]?.settings?.title,
            content: postDetails?.[0]?.message,
            slug: slugify(postDetails?.[0]?.settings?.title, {
              lower: true,
              strict: true,
              trim: true,
            }),
            status: 'publish',
            ...(mediaId ? { featured_media: mediaId } : {}),
          }),
        }
      )
    ).json();

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: String(submit.id),
        releaseURL: submit.link,
      },
    ];
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new WordpressProvider();

export const wordpressSocialModule: __ProviderModule<any, any> = {
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
