import {
  AuthTokenDetails,
  ChannelSetupDescriptor,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postmill-ai/provider-kernel';
import { makeId, makeOauthState } from '@postmill-ai/provider-kernel';
import { safeFetch, SocialAbstract } from '@postmill-ai/provider-kernel';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// Validate the user-supplied forum URL before it is interpolated into API
// calls (same posture as the peertube adapter): https only, bare origin, no
// IP literals. Subfolder installs (example.com/forum) are not supported —
// the outbound calls themselves go through the SSRF-hardened kernel fetch port.
function validateBaseUrl(value: unknown): { ok: true; base: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Invalid forum URL' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'Invalid forum URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Forum URL must use HTTPS' };
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost') {
    return { ok: false, error: 'Invalid hostname' };
  }
  if (net.isIP(hostname)) {
    return { ok: false, error: 'IP addresses are not allowed' };
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, error: 'Forum URL must be a bare origin (no path or query)' };
  }
  return { ok: true, base: url.origin };
}

function assertDiscourseBody(body: unknown): {
  base: string;
  apiKey: string;
  apiUsername: string;
  defaultCategory?: string;
} {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid credentials');
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.baseUrl !== 'string' ||
    typeof record.apiKey !== 'string' ||
    typeof record.apiUsername !== 'string' ||
    !record.baseUrl.trim() ||
    !record.apiKey.trim() ||
    !record.apiUsername.trim()
  ) {
    throw new Error('Invalid credentials');
  }
  const validation = validateBaseUrl(record.baseUrl);
  if ('error' in validation) {
    throw new Error(validation.error);
  }
  return {
    base: validation.base,
    apiKey: record.apiKey,
    apiUsername: record.apiUsername,
    defaultCategory:
      typeof record.defaultCategory === 'string' && record.defaultCategory.trim()
        ? record.defaultCategory.trim()
        : undefined,
  };
}

function parseDiscourseCallback(token: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    throw new Error('Invalid credentials');
  }
  return assertDiscourseBody(parsed);
}

// Derive a topic title from the post body: strip markdown, take ~50 chars.
// Discourse's default min_topic_title_length is 15, so very short messages
// get a date suffix instead of failing server-side validation.
function deriveTitle(message: string): string {
  const plain = (message || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/[#*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let title = plain.slice(0, 50).trim();
  if (title.length < 15) {
    title = `${title || 'Scheduled post'} — ${dayjs().format('YYYY-MM-DD HH:mm')}`;
  }
  return title;
}

// Discourse API (Api-Key / Api-Username header auth). Verified against
// https://docs.discourse.org and the Discourse Meta API guides:
// - POST {base}/posts.json        — { title, raw, category? } creates a topic;
//                                   { topic_id, raw } replies to a topic.
// - POST {base}/uploads.json      — multipart (type=composer, file) →
//                                   { id, url, short_url, original_filename, width, height }
// - GET  {base}/session/current.json — credential verification.
export class DiscourseProvider extends SocialAbstract implements SocialProvider {
  identifier = 'discourse';
  name = 'Discourse';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 2;
  toolTip = 'Enter your forum URL, an admin API key and its username.';

  // Forum + API-key channel: no developer app, no callback — the channel
  // connects with forum URL + API key + username in the composer connect
  // flow (customFields); the config form shows guidance only.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalLabel: 'Discourse admin → API keys (/admin/api/keys)',
    setupSteps: [
      'You need admin access to your Discourse forum (self-hosted or hosted).',
      'In your forum, go to Admin → API → API Keys (yourforum.com/admin/api/keys) and click "New API Key".',
      'Set User Level to "Single User" and pick the user the posts should appear as. Give the key the Topics write scope (or Global scope), save, and copy the generated key.',
      'Back here, open Create new → New Channel → Discourse and enter your Forum URL, the API Key and the API Username, then click Connect. Optionally set a default category ID (the number at the end of a category\'s URL).',
    ],
  };

  maxLength() {
    // Discourse's default max_post_length site setting is 32000 characters
    // (admin-configurable; the composer cap follows the default).
    return 32000;
  }

  async customFields() {
    return [
      {
        key: 'baseUrl',
        label: 'Forum URL',
        defaultValue: 'https://',
        validation: `/^https:\\/\\/.+/`,
        type: 'text' as const,
      },
      {
        key: 'apiKey',
        label: 'API Key',
        validation: `/^.{8,}$/`,
        type: 'password' as const,
      },
      {
        key: 'apiUsername',
        label: 'API Username',
        validation: `/^.+$/`,
        type: 'text' as const,
      },
      {
        // Optional: empty means "no category" (Discourse posts to uncategorized).
        key: 'defaultCategory',
        label: 'Default Category ID (optional)',
        validation: `/^\\d*$/`,
        type: 'text' as const,
      },
    ];
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    // Discourse API keys do not expire (they are revoked manually).
    return {
      id: '', name: '', username: '', picture: '',
      accessToken: '', refreshToken: '', expiresIn: 0,
    };
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return { url: state, codeVerifier: makeId(10), state };
  }

  private headers(creds: { apiKey: string; apiUsername: string }) {
    return {
      'Api-Key': creds.apiKey,
      'Api-Username': creds.apiUsername,
    };
  }

  // Connect-time verification: GET /session/current.json with the API key.
  async authenticate(params: { code: string; codeVerifier: string }) {
    let creds: ReturnType<typeof assertDiscourseBody>;
    try {
      creds = parseDiscourseCallback(params.code);
    } catch (err) {
      return 'Invalid Discourse credentials';
    }

    const session = await (
      await this.fetch(`${creds.base}/session/current.json`, {
        headers: this.headers(creds),
      }, this.identifier)
    ).json();

    const user = session?.current_user;
    if (!user?.id) {
      return 'Invalid Discourse API key or username';
    }

    const avatar = user.avatar_template
      ? `${creds.base}${String(user.avatar_template).replace('{size}', '120')}`
      : '';

    return {
      id: String(user.id),
      name: user.name || user.username,
      accessToken: creds.apiKey,
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: avatar,
      username: user.username,
    };
  }

  override handleErrors(body: string, status: number) {
    if (status === 401 || status === 403) {
      return {
        type: 'refresh-token' as const,
        value: 'Discourse API key was rejected — reconnect the channel with a valid API key',
      };
    }
    return undefined;
  }

  private creds(integration: Integration) {
    return assertDiscourseBody(
      JSON.parse(AuthService.fixedDecryption(integration.customInstanceDetails!))
    );
  }

  // Upload one attachment and return the markdown to embed in the post body.
  private async uploadMedia(
    creds: { base: string; apiKey: string; apiUsername: string },
    media: { type: 'image' | 'video'; path: string; alt?: string }
  ): Promise<string> {
    const blob = await safeFetch(media.path).then((r) => r.blob());
    const filename = media.path.split('?')[0].split('/').pop() || 'file';

    const form = new FormData();
    form.append('type', 'composer');
    form.append('synchronous', 'true');
    form.append('file', blob, filename);

    const upload = await (
      await this.fetch(`${creds.base}/uploads.json`, {
        method: 'POST',
        headers: this.headers(creds),
        body: form,
      }, this.identifier)
    ).json();

    if (!upload?.short_url) {
      throw new Error('Discourse upload failed');
    }

    if (media.type === 'image') {
      const dimensions =
        upload.width && upload.height ? `|${upload.width}x${upload.height}` : '';
      return `![${media.alt || upload.original_filename || filename}${dimensions}](${upload.short_url})`;
    }
    return `[${upload.original_filename || filename}](${upload.short_url})`;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    const creds = this.creds(integration);

    let raw = (first.message || '').slice(0, this.maxLength());
    for (const media of first.media || []) {
      raw += `\n\n${await this.uploadMedia(creds, media)}`;
    }

    const created = await (
      await this.fetch(`${creds.base}/posts.json`, {
        method: 'POST',
        headers: { ...this.headers(creds), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: deriveTitle(first.message || ''),
          raw,
          ...(creds.defaultCategory ? { category: Number(creds.defaultCategory) } : {}),
        }),
      }, this.identifier)
    ).json();

    if (!created?.topic_id) {
      throw new Error('Discourse topic creation failed');
    }

    return [
      {
        id: first.id,
        // The topic id is stored as postId so comment() can reply into the topic.
        postId: String(created.topic_id),
        releaseURL: `${creds.base}/t/${created.topic_slug}/${created.topic_id}/${created.post_number || 1}`,
        status: 'completed',
      },
    ];
  }

  // A comment is a reply inside the topic created by post() (postId = topic id).
  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [c] = postDetails;
    const creds = this.creds(integration);

    let raw = (c.message || '').slice(0, this.maxLength());
    for (const media of c.media || []) {
      raw += `\n\n${await this.uploadMedia(creds, media)}`;
    }

    const created = await (
      await this.fetch(`${creds.base}/posts.json`, {
        method: 'POST',
        headers: { ...this.headers(creds), 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: Number(postId), raw }),
      }, this.identifier)
    ).json();

    return [
      {
        id: c.id,
        postId: String(created?.id || ''),
        releaseURL: created?.topic_id
          ? `${creds.base}/t/${created.topic_slug}/${created.topic_id}/${created.post_number || ''}`
          : '',
        status: 'completed',
      },
    ];
  }
}

// ---- provider-kernel module ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

const __adapter = new DiscourseProvider();

export const discourseSocialModule: __ProviderModule<any, any> = {
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
