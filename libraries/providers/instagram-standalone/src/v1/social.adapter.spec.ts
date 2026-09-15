import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstagramStandaloneProvider } from './social.adapter';

// Instagram Login exposes two ids on /me: `user_id` (professional account id,
// what the content APIs address) and `id` (app-scoped id, what Meta's
// deauthorize / data-deletion callbacks carry). The adapter must keep both.
const json = (value: unknown) => ({ json: async () => value });

const mockFetch = () =>
  vi.fn(async (url: string) => {
    if (url.startsWith('https://api.instagram.com/oauth/access_token')) {
      return json({ access_token: 'short', permissions: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights' });
    }
    if (url.startsWith('https://graph.instagram.com/access_token')) {
      return json({ access_token: 'long-lived', expires_in: 5184000 });
    }
    if (url.startsWith('https://graph.instagram.com/refresh_access_token')) {
      return json({ access_token: 'refreshed' });
    }
    if (url.startsWith('https://graph.instagram.com/v21.0/me?')) {
      expect(url).toContain('fields=id,user_id,');
      return json({ id: '9876543210', user_id: '17841400000000001', name: 'Rick', username: 'rick', profile_picture_url: 'https://p/x.png' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

describe('InstagramStandaloneProvider identities', () => {
  const saved = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = saved;
  });

  it('authenticate: id = professional account id, rootId = app-scoped id', async () => {
    const provider = new InstagramStandaloneProvider();
    (provider as any).fetch = mockFetch();
    (provider as any).checkScopes = vi.fn();
    const result = await provider.authenticate(
      { code: 'c', codeVerifier: 'v', refresh: '' },
      { client_id: 'id', client_secret: 'secret' } as any,
    );
    expect(result).toMatchObject({ id: '17841400000000001', rootId: '9876543210', username: 'rick', accessToken: 'long-lived' });
  });

  it('refreshToken: also reports rootId so a reconnect backfills older rows', async () => {
    const provider = new InstagramStandaloneProvider();
    (provider as any).fetch = mockFetch();
    const result = await provider.refreshToken('old');
    expect(result).toMatchObject({ id: '17841400000000001', rootId: '9876543210', accessToken: 'refreshed' });
  });
});
