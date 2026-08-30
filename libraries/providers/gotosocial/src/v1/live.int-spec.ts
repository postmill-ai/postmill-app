/**
 * LIVE end-to-end spec for the GoToSocial channel against a REAL GoToSocial
 * server (e.g. a local `superseriousbusiness/gotosocial` container over plain
 * http). Skipped unless ALL of these env vars are set:
 *
 *   GTS_E2E_URL           e.g. http://127.0.0.1:8484
 *   GTS_E2E_CLIENT_ID     OAuth app client_id (POST /api/v1/apps)
 *   GTS_E2E_CLIENT_SECRET OAuth app client_secret
 *   GTS_E2E_CODE          fresh authorization_code (OOB authorize flow)
 *
 * The code is single-use and short-lived — obtain it immediately before the
 * run: open {GTS_E2E_URL}/oauth/authorize?client_id=...&redirect_uri=
 * urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=read+write in a browser,
 * sign in, authorize, and copy the shown code.
 *
 * NOTE: this spec installs REAL network fetch ports (no SSRF guard) because
 * the live target is intentionally a local plain-http server — the production
 * ports would (correctly) refuse it. Never point this at a production server.
 *
 * The it() blocks are order-dependent by design: they model one realistic
 * channel lifecycle (auth → post → comment → engage → analytics).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Agent, fetch as undiciRealFetch } from 'undici';
import { GoToSocialProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

const GTS_URL = process.env.GTS_E2E_URL;
const CLIENT_ID = process.env.GTS_E2E_CLIENT_ID;
const CLIENT_SECRET = process.env.GTS_E2E_CLIENT_SECRET;
const CODE = process.env.GTS_E2E_CODE;
const TOKEN = process.env.GTS_E2E_TOKEN;
// Full flow: URL + app creds + fresh CODE (browser authorize). Repeat runs may
// skip the exchange step by passing a still-valid GTS_E2E_TOKEN instead.
const RUN = !!(GTS_URL && ((CLIENT_ID && CLIENT_SECRET && CODE) || TOKEN));

// 64x64 solid red PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURcA5K////28zc6EAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggeFB40FWc57wAAAA9JREFUKM9jYBgFo4B8AAACQAABjMWrdwAAAABJRU5ErkJggg==';

describe.skipIf(!RUN)('GoToSocialProvider LIVE e2e (real GoToSocial server)', () => {
  const provider = new GoToSocialProvider();
  const clientInformation = {
    client_id: '',
    client_secret: '',
    instanceUrl: GTS_URL,
  } as any;
  const integration = {} as any;

  let mediaServer: http.Server;
  let mediaUrl = '';
  let accessToken = '';
  let accountId = '';
  let postId = '';
  let commentId = '';
  const stamp = Date.now();

  beforeAll(async () => {
    setSocialFetchPorts({
      safeFetch: (url: string, init?: any) => fetch(url, init),
      undiciFetch: (url: string, init?: any) => undiciRealFetch(url, init),
      ssrfSafeDispatcher: new Agent(),
      getVpnDispatcher: () => undefined,
      isSafePublicHttpsUrl: async () => true,
      RefreshTokenError: class extends Error {},
      BadBodyError: class extends Error {},
      timer: async () => undefined,
      sharp: ((b: any) => b) as any,
      readOrFetch: async (u: string) =>
        Buffer.from(await (await fetch(u)).arrayBuffer()),
    } as any);

    mediaServer = http.createServer((_req, res) => {
      res.setHeader('content-type', 'image/png');
      res.end(Buffer.from(PNG_B64, 'base64'));
    });
    await new Promise<void>((resolve) =>
      mediaServer.listen(0, '127.0.0.1', resolve)
    );
    const addr = mediaServer.address() as any;
    mediaUrl = `http://127.0.0.1:${addr.port}/pixel.png`;
  });

  afterAll(async () => {
    await new Promise((resolve) => mediaServer?.close(resolve));
  });

  it('authenticates: authorization-code exchange, or reuses GTS_E2E_TOKEN', async () => {
    if (CODE) {
      const auth = (await (provider as any).dynamicAuthenticate(
        CLIENT_ID,
        CLIENT_SECRET,
        GTS_URL,
        CODE
      )) as any;

      expect(auth.accessToken).toBeTruthy();
      expect(auth.username).toBe('e2e');
      expect(auth.id).toBeTruthy();

      accessToken = auth.accessToken;
      accountId = auth.id;
    } else {
      accessToken = TOKEN!;
      const me = (await (
        await fetch(`${GTS_URL}/api/v1/accounts/verify_credentials`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json()) as any;
      expect(me.username).toBe('e2e');
      accountId = me.id;
    }
  });

  it('publishes a text+image status (real /api/v1/media + /api/v1/statuses)', async () => {
    const res = await provider.post(
      'ignored',
      accessToken,
      [
        {
          id: 'p1',
          message: `Postmill live e2e ${stamp}`,
          settings: {},
          media: [{ type: 'image', path: mediaUrl, alt: 'e2e red square' }],
        } as any,
      ],
      integration,
      clientInformation
    );

    expect(res[0].status).toBe('completed');
    expect(res[0].postId).toBeTruthy();
    expect(res[0].releaseURL).toBe(`${GTS_URL}/statuses/${res[0].postId}`);
    postId = res[0].postId;

    // Independent server-side confirmation: the status exists with the media
    // attached (not just a 200 from the provider's perspective).
    const status = (await (
      await fetch(`${GTS_URL}/api/v1/statuses/${postId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).json()) as any;
    expect(status.content).toContain(`Postmill live e2e ${stamp}`);
    expect(status.media_attachments?.length).toBe(1);
    expect(status.media_attachments[0].description).toBe('e2e red square');
  });

  it('posts a first comment (reply) to the status', async () => {
    const res = await provider.comment(
      'ignored',
      postId,
      undefined,
      accessToken,
      [
        {
          id: 'c1',
          message: `e2e first comment ${stamp}`,
          settings: {},
          media: [],
        } as any,
      ],
      integration,
      clientInformation
    );

    expect(res[0].status).toBe('completed');
    commentId = res[0].postId;
    expect(commentId).toBeTruthy();
  });

  it('fetches the comment thread back', async () => {
    const { comments } = await provider.fetchComments(
      accountId,
      accessToken,
      postId,
      undefined,
      integration,
      clientInformation
    );

    const mine = comments.find((c) => c.platformCommentId === commentId);
    expect(mine).toBeTruthy();
    expect(mine!.content).toContain(`e2e first comment ${stamp}`);
    expect(mine!.author.username).toContain('e2e');
  });

  it('likes its own comment', async () => {
    const res = await provider.likeComment(
      accountId,
      accessToken,
      postId,
      commentId,
      true,
      integration,
      clientInformation
    );

    expect(res.liked).toBe(true);
    expect(res.likeCount).toBeGreaterThanOrEqual(1);
  });

  it('reads channel analytics (followers)', async () => {
    const res = await provider.analytics(
      accountId,
      accessToken,
      0,
      clientInformation
    );

    expect(res[0]?.label).toBe('Followers');
    expect(Number(res[0]?.data[0]?.total)).toBeGreaterThanOrEqual(0);
  });

  it('reads post analytics (favourites/reblogs/replies)', async () => {
    const res = await provider.postAnalytics(
      'ignored',
      accessToken,
      postId,
      0,
      clientInformation
    );

    const labels = res.map((r) => r.label);
    expect(labels).toContain('Favourites');
    expect(labels).toContain('Reblogs');
    expect(labels).toContain('Replies');
    const replies = res.find((r) => r.label === 'Replies');
    expect(Number(replies?.data[0]?.total)).toBeGreaterThanOrEqual(1);
  });
});
