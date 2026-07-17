import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { ListmonkDto } from '@gitroom/provider-kernel';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import slugify from 'slugify';
import { Tool } from '@gitroom/provider-kernel';
import { safeFetch } from '@gitroom/provider-kernel';
import { Logger } from '@nestjs/common';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// S-12: validate callback URL before interpolating it into API calls.
function validateListmonkUrl(value: unknown): { ok: true; base: string } | { ok: false; error: string } {
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
  if (net.isIP(hostname)) {
    return { ok: false, error: 'IP addresses are not allowed' };
  }
  const base = url.toString().replace(/\/$/, '');
  return { ok: true, base };
}

function assertListmonkBody(body: unknown): { url: string; username: string; password: string } {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid credentials');
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.url !== 'string' ||
    typeof record.username !== 'string' ||
    typeof record.password !== 'string' ||
    !record.url.trim() ||
    !record.username.trim() ||
    !record.password.trim()
  ) {
    throw new Error('Invalid credentials');
  }
  const validation = validateListmonkUrl(record.url);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    url: validation.base,
    username: record.username,
    password: record.password,
  };
}

function parseListmonkCallback(token: string): { url: string; username: string; password: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid credentials');
  }
  return assertListmonkBody(parsed);
}
export class ListmonkProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(ListmonkProvider.name);
  override maxConcurrentJob = 100; // ListMonk has moderate rate limits
  identifier = 'listmonk';
  name = 'ListMonk';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = ListmonkDto;

  maxLength() {
    return 100000000;
  }

  async customFields() {
    return [
      {
        key: 'url',
        label: 'URL',
        defaultValue: '',
        validation: `/^(https?:\\/\\/)(?:\\S+(?::\\S*)?@)?(?:(?:localhost)|(?:\\d{1,3}(?:\\.\\d{1,3}){3})|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63})(?::\\d{2,5})?(?:\\/[^\\s?#]*)?(?:\\?[^\\s#]*)?(?:#[^\\s]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'username',
        label: 'Username',
        validation: `/^.+$/`,
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
    let body: { url: string; username: string; password: string };
    try {
      body = parseListmonkCallback(params.code);
    } catch (err) {
      this.logger.warn('Listmonk callback validation failed');
      return 'Invalid credentials';
    }

    try {
      const basic = Buffer.from(body.username + ':' + body.password).toString(
        'base64'
      );

      const { data } = await (
        await safeFetch(body.url + '/api/settings', {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: 'Basic ' + basic,
          },
        })
      ).json();

      return {
        refreshToken: basic,
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: basic,
        id: Buffer.from(body.url).toString('base64'),
        name: data['app.site_name'],
        picture: data['app.logo_url'] || '',
        username: data['app.site_name'],
      };
    } catch (e) {
      this.logger.warn('Listmonk authentication failed');
      return 'Invalid credentials';
    }
  }

  @Tool({ description: 'List of available lists', dataSchema: [] })
  async list(
    token: string,
    data: any,
    internalId: string,
    integration: Integration
  ) {
    const body = assertListmonkBody(
      JSON.parse(
        AuthService.fixedDecryption(integration.customInstanceDetails!)
      )
    );

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    const postTypes = await (
      await safeFetch(`${body.url}/api/lists`, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      })
    ).json();

    return postTypes.data.results.map((p: any) => ({ id: p.id, name: p.name }));
  }

  @Tool({ description: 'List of available templates', dataSchema: [] })
  async templates(
    token: string,
    data: any,
    internalId: string,
    integration: Integration
  ) {
    const body = assertListmonkBody(
      JSON.parse(
        AuthService.fixedDecryption(integration.customInstanceDetails!)
      )
    );

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    const postTypes = await (
      await safeFetch(`${body.url}/api/templates`, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      })
    ).json();

    return [
      { id: 0, name: 'Default' },
      ...postTypes.data.map((p: any) => ({ id: p.id, name: p.name })),
    ];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<ListmonkDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const body = assertListmonkBody(
      JSON.parse(
        AuthService.fixedDecryption(integration.customInstanceDetails!)
      )
    );

    const auth = Buffer.from(`${body.username}:${body.password}`).toString(
      'base64'
    );

    const sendBody = `
<style>
.content {
  padding: 20px;
  font-size: 15px;
  line-height: 1.6;
}
</style>
<div class="hidden-preheader"
       style="display:none !important; visibility:hidden; opacity:0; overflow:hidden;
              max-height:0; max-width:0; line-height:1px; font-size:1px; color:transparent;
              mso-hide:all;">
    <!-- A short visible decoy (optional): shows as "." or short text in preview -->
    ${postDetails?.[0]?.settings?.preview || ''}
    <!-- Then invisible padding to eat up preview characters -->
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    <!-- Repeat the trio (zero-width space, zero-width non-joiner, nbsp, BOM) a bunch of times -->
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
    &#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;&#8203;&zwnj;&nbsp;&#65279;
  </div>
  
  <div class="content">
    ${postDetails[0].message}
  </div>
`;

    const {
      data: { uuid: postId, id: campaignId },
    } = await (
      await safeFetch(body.url + '/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          name: slugify(postDetails[0].settings.subject, {
            lower: true,
            strict: true,
            trim: true,
          }),
          type: 'regular',
          content_type: 'html',
          subject: postDetails[0].settings.subject,
          lists: [+postDetails[0].settings.list],
          body: sendBody,
          ...(+postDetails?.[0]?.settings?.template
            ? { template_id: +postDetails[0].settings.template }
            : {}),
        }),
      })
    ).json();

    await safeFetch(body.url + `/api/campaigns/${campaignId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        status: 'running',
      }),
    });

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        releaseURL: `${body.url}/api/campaigns/${campaignId}/preview`,
        postId,
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

const __adapter = new ListmonkProvider();

export const listmonkSocialModule: __ProviderModule<any, any> = {
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
