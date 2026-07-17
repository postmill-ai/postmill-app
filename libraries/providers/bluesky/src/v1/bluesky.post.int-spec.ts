import { describe, it, expect, vi } from 'vitest';

// F3 — Social-adapter posting contract test (Bluesky).
//
// Bluesky posts through the `@atproto/api` SDK (BskyAgent.post), NOT SocialAbstract.fetch,
// so the URL/host/method/auth-header are abstracted inside the SDK and can't be observed
// from a recording fetch. We therefore mock the SDK and assert the strongest available
// contract: login happens against the credentialed service, the SDK post() call carries
// the message text, and the returned releaseURL points at bsky.app.

const h = vi.hoisted(() => ({
  postArgs: [] as any[],
  loginArgs: [] as any[],
  agentOpts: [] as any[],
}));

vi.mock('@atproto/api', () => ({
  BskyAgent: class {
    constructor(public opts: any) {
      h.agentOpts.push(opts);
    }
    async login(args: any) {
      h.loginArgs.push(args);
    }
    async post(record: any) {
      h.postArgs.push(record);
      return { cid: 'cid-1', uri: 'at://did:plc:abc/app.bsky.feed.post/xyz' };
    }
    async uploadBlob() {
      return { data: { blob: {} } };
    }
  },
  AtpAgent: class {},
  RichText: class {
    text: string;
    facets: any[] = [];
    constructor(o: any) {
      this.text = o.text;
    }
    async detectFacets() {}
  },
  AppBskyEmbedVideo: {},
  AppBskyVideoDefs: {},
  BlobRef: class {},
}));

vi.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: () =>
      JSON.stringify({
        service: 'https://bsky.social',
        identifier: 'me.bsky.social',
        password: 'app-password',
      }),
  },
}));

import { BlueskyProvider } from './social.adapter';

describe('bluesky provider post() contract', () => {
  it('logs in against the credentialed service and posts the message via the SDK', async () => {
    const provider = new BlueskyProvider();

    const out = await provider.post(
      'me.bsky.social',
      'unused-access-token',
      [{ id: 'p1', message: 'hello bluesky world', media: [], settings: {} } as any],
      { customInstanceDetails: 'encrypted' } as any
    );

    // Agent constructed against the decrypted service host.
    expect(h.agentOpts[0]).toEqual({ service: 'https://bsky.social' });
    expect(h.loginArgs[0]).toMatchObject({ identifier: 'me.bsky.social' });

    // The SDK post call carries the content.
    expect(h.postArgs[0].text).toBe('hello bluesky world');

    // Release URL is on bsky.app and references the created record.
    expect(out[0].postId).toBe('at://did:plc:abc/app.bsky.feed.post/xyz');
    expect(new URL(out[0].releaseURL!).host).toBe('bsky.app');
    expect(out[0].releaseURL).toContain('/post/xyz');
  });
});
