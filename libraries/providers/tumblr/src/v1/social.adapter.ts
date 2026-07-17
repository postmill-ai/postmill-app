import {
  AuthTokenDetails, ClientInformation, PostDetails, PostResponse, SocialProvider,
} from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { safeFetch } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class TumblrProvider extends SocialAbstract implements SocialProvider {
  identifier = 'tumblr';
  name = 'Tumblr';
  isBetweenSteps = false;
  // NPF text blocks render plain text only (formatting is expressed via separate
  // index ranges, never HTML), so we use the plain-text editor like the other
  // social providers (mastodon/bluesky/threads). Using 'html' here would dump raw
  // tags such as <strong>/<p> into the post as literal text.
  editor = 'normal' as const;
  scopes = ['basic', 'write', 'offline_access'];
  override maxConcurrentJob = 3;
  maxLength() {
    return 4096;
  }

  private redirectUri() {
    return `${process.env.FRONTEND_URL}/integrations/social/tumblr`;
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    const clientId = clientInformation?.client_id || '';
    const url =
      `https://www.tumblr.com/oauth2/authorize?client_id=${clientId}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(this.scopes.join(' '))}` +
      `&state=${state}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri())}`;
    return { url, codeVerifier: makeId(10), state };
  }

  async authenticate(params: { code: string; codeVerifier: string; refresh?: string }, clientInformation?: ClientInformation) {
    const clientId = clientInformation?.client_id || '';
    const clientSecret = clientInformation?.client_secret || '';

    const token = await (
      await this.fetch('https://api.tumblr.com/v2/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: this.redirectUri(),
        }).toString(),
      })
    ).json();

    const info = await (
      await this.fetch('https://api.tumblr.com/v2/user/info', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
    ).json();

    const blog = info?.response?.user?.blogs?.[0];
    if (!blog?.name) {
      throw new Error('No Tumblr blog found for this account');
    }
    return {
      id: blog.name,
      name: blog.title || blog.name,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || '',
      expiresIn: token.expires_in || 3600,
      picture: blog?.avatar?.[0]?.url || '',
      username: blog.name,
    };
  }

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const clientId = clientInformation?.client_id || '';
    const clientSecret = clientInformation?.client_secret || '';
    const token = await (
      await this.fetch('https://api.tumblr.com/v2/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      })
    ).json();
    return {
      id: '', name: '', username: '', picture: '',
      accessToken: token.access_token,
      refreshToken: token.refresh_token || refreshToken,
      expiresIn: token.expires_in || 3600,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    const blog = id;
    // Only emit a text block when there's actually a message — an empty NPF text
    // block is rejected by Tumblr, which breaks media-only (no caption) posts.
    const content: any[] = first.message
      ? [{ type: 'text', text: first.message }]
      : [];
    const form = new FormData();
    const media = first.media || [];

    for (let i = 0; i < media.length; i++) {
      const m = media[i];
      const key = `media-${i}`;
      const blob = await safeFetch(m.path).then((r) => r.blob());
      form.append(key, blob);
      content.push({
        type: m.path.endsWith('.mp4') ? 'video' : 'image',
        media: [{ type: blob.type, identifier: key }],
        ...(m.alt ? { alt_text: m.alt } : {}),
      });
    }

    form.append(
      'json',
      JSON.stringify({ content, state: 'published' })
    );

    const res = await (
      await this.fetch(`https://api.tumblr.com/v2/blog/${blog}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      })
    ).json();

    const postId = res?.response?.id_string || res?.response?.id;
    if (!postId) {
      throw new Error('Failed to create Tumblr post - no post ID returned');
    }
    return [
      {
        id: first.id,
        postId: String(postId),
        releaseURL: `https://${blog}.tumblr.com/post/${postId}`,
        status: 'completed',
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

const __adapter = new TumblrProvider();

export const tumblrSocialModule: __ProviderModule<any, any> = {
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
