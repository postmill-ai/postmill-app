import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventEmitter from 'events';

vi.mock('sharp', () => ({ default: vi.fn(function() {
  return {
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    toFormat: vi.fn(() => ({
      resize: vi.fn(() => ({ toBuffer: vi.fn().mockResolvedValue(Buffer.from('image')) })),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('image')),
    })),
    resize: vi.fn(() => ({ gif: vi.fn(() => ({ toBuffer: vi.fn().mockResolvedValue(Buffer.from('gif')) })) })),
    gif: vi.fn(() => ({ toBuffer: vi.fn().mockResolvedValue(Buffer.from('gif')) })),
  };
}) }));
vi.mock('@gitroom/helpers/utils/timer', () => ({ timer: vi.fn() }));
vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: vi.fn().mockResolvedValue(Buffer.from('data')) }));
// safeFetch's SSRF pre-validation does real DNS; delegate to the mocked global
// fetch so provider-logic specs stay deterministic (SSRF blocking is covered by
// social.abstract.spec.ts). Matches that spec's safe.fetch mock.
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({ safeFetch: vi.fn((url: string, options?: RequestInit) => (globalThis.fetch as any)(url, options)) }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(), ProviderConfiguration: class {}, Integration: class {} }));
vi.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { fixedEncryption: vi.fn((s: string) => s), fixedDecryption: vi.fn((s: string) => s) } }));
vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service', () => ({
  ProviderConfigService: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue([]), getByIdentifier: vi.fn(), decryptConfig: vi.fn(function() { return {}; }), upsert: vi.fn(), delete: vi.fn() })),
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.repository', () => ({
  ProviderConfigRepository: vi.fn(() => ({ getAll: vi.fn(), getByIdentifier: vi.fn(), upsert: vi.fn(), delete: vi.fn(), setEnabled: vi.fn() })),
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(() => ({ model: {} })),
  PrismaService: class {},
}));
vi.mock('@gitroom/nestjs-libraries/integrations/credentials', () => ({
  getOrgCredential: () => 'mock-value',
  setCredentials: vi.fn(),
  getCredential: vi.fn(() => undefined),
  clearCredentials: vi.fn(),
  replaceCredentialsMap: vi.fn(),
}));
const mockTwitterApiV2 = vi.hoisted(() => () => ({
  me: vi.fn().mockResolvedValue({ data: { id: '123', name: 'Test User', username: 'testuser', verified: true, profile_image_url: 'https://ex.com/pic.jpg' } }),
  tweet: vi.fn().mockResolvedValue({ data: { id: 'tweet-123' } }),
  tweetLikedBy: vi.fn().mockResolvedValue({ meta: { result_count: 5 } }),
  retweet: vi.fn().mockResolvedValue({}),
  uploadMedia: vi.fn().mockResolvedValue('media-123'),
  userTimeline: vi.fn().mockResolvedValue({ data: { data: [{ id: 't1' }], meta: { result_count: 1 } } }),
  tweets: vi.fn().mockResolvedValue({ data: [{ id: 't1', public_metrics: { impression_count: 100, bookmark_count: 10, like_count: 50, quote_count: 5, reply_count: 3, retweet_count: 20 } }] }),
  singleTweet: vi.fn().mockResolvedValue({ data: { public_metrics: { impression_count: 100, like_count: 50, retweet_count: 20, reply_count: 3, quote_count: 5, bookmark_count: 10 } } }),
  userByUsername: vi.fn().mockResolvedValue({ data: { username: 'testuser', name: 'Test', profile_image_url: 'https://ex.com/pic.jpg' } }),
}));
vi.mock('twitter-api-v2', () => {
  class MockTwitterApi {
    appKey: string; appSecret: string; accessToken: string; accessSecret: string;
    constructor(opts: any) { Object.assign(this, opts); }
    generateAuthLink = vi.fn().mockResolvedValue({ url: 'https://x.com/oauth/authorize?oauth_token=tok', oauth_token: 'tok', oauth_token_secret: 'sec' });
    login = vi.fn().mockResolvedValue({ accessToken: 'at', client: { v2: mockTwitterApiV2() }, accessSecret: 'as' });
    get v2() { return mockTwitterApiV2(); }
  }
  return { TwitterApi: MockTwitterApi };
});
vi.mock('ws', () => {
  return { default: class MockWebSocket extends EventEmitter { close = vi.fn(); } };
});
const mockAxiosFn = vi.hoisted(() => {
  const fn = vi.fn().mockResolvedValue({ data: { pipe: vi.fn(() => ({ pipe: vi.fn() })) }, status: 200 });
  fn.get = vi.fn().mockResolvedValue({ data: Buffer.from('video-data'), status: 200 });
  fn.post = vi.fn().mockResolvedValue({ status: 200, data: {} });
  return fn;
});
vi.mock('axios', () => ({ default: mockAxiosFn }));
vi.mock('form-data', () => ({ default: class FormData { append = vi.fn(); getHeaders = vi.fn(function() { return {}; }); } }));
vi.mock('image-to-pdf', () => ({ default: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn((e: string, cb: any) => { if (e === 'data') cb(Buffer.from('pdf')); if (e === 'end') cb(); }) })) }));

const mockYtClient = vi.hoisted(() => ({
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=gmb123'),
  getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'gmb-tok', refresh_token: 'gmb-rtok', expiry_date: Date.now() + 3600000 } }),
  setCredentials: vi.fn(),
  getTokenInfo: vi.fn().mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/business.manage'] }),
  refreshAccessToken: vi.fn().mockResolvedValue({ credentials: { access_token: 'new-gmb-tok', refresh_token: 'gmb-rtok', expiry_date: Date.now() + 3600000 } }),
}));
const mockYtOauth2 = vi.hoisted(() => ({ userinfo: { get: vi.fn().mockResolvedValue({ data: { id: '123', name: 'Test User', picture: 'https://ex.com/pic.jpg' } }) } }));
vi.mock('googleapis', () => {
  return {
    google: {
      auth: { OAuth2: vi.fn(function() { return mockYtClient; }) },
      oauth2: vi.fn(function() { return mockYtOauth2; }),
      youtube: vi.fn(),
      youtubeAnalytics: vi.fn(),
    },
  };
});

process.env.FRONTEND_URL = 'https://app.example.com';

import { RefreshTokenError, BadBodyError } from '@gitroom/nestjs-libraries/inngest/errors';
import { DribbbleProvider } from './dribbble.provider';
import { DiscordProvider } from './discord.provider';
import { SlackProvider } from './slack.provider';
import { MastodonProvider } from './mastodon.provider';
import { GmbProvider } from './gmb.provider';
import { VkProvider } from './vk.provider';
import { WhopProvider } from './whop.provider';
import { MeweProvider } from './mewe.provider';
import { KickProvider } from './kick.provider';
import { TwitchProvider } from './twitch.provider';

function resp(data: any, headers?: Record<string, string>) {
  const headerMap = new Map();
  if (headers) {
    Object.entries(headers).forEach(([k, v]) => headerMap.set(k, v));
  }
  return {
    status: 200, ok: true,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    blob: vi.fn().mockResolvedValue(new Blob()),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    headers: headerMap,
  } as any;
}

function respError(body: string, status: number) {
  return {
    status, ok: false,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
    blob: vi.fn().mockResolvedValue(new Blob()),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    headers: new Map(),
  } as any;
}

// ─────────────────────────────────────────────────────────────
// 1. DRIBBBLE PROVIDER
// ─────────────────────────────────────────────────────────────
describe('dribbble deep', () => {
  let provider: DribbbleProvider;

  beforeEach(() => {
    provider = new DribbbleProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 40000', () => {
    expect(provider.maxLength()).toBe(40000);
  });

  it('checkValidity requires exactly one item', async () => {
    const r = await provider.checkValidity([[]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity rejects mp4', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with valid dimensions', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]]);
    expect(r).toBe(true);
  });

  it('refreshToken calls token and user endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', username: 'testuser', profile_image: 'https://ex.com/pic.jpg' })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.username).toBe('testuser');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('dribbble.com/oauth/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', scope: 'public upload' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', name: 'Test User', avatar_url: 'https://ex.com/av.jpg', login: 'testuser' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v', refresh: '' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
    expect(r.username).toBe('testuser');
  });

  it('post uploads shot via safeFetch and this.fetch', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({}))) // media download
      .mockImplementationOnce(() => Promise.resolve(resp({}, { location: 'https://dribbble.com/shots/456' }))); // upload shot
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'My shot', media: [{ path: 'https://ex.com/img.jpg' }], settings: { title: 'My Shot' } }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('456');
    expect(r[0].releaseURL).toContain('dribbble.com/shots/');
  });

  it('analytics returns empty', async () => {
    const r = await provider.analytics('123', 'tok', 7);
    expect(r).toEqual([]);
  });

  it('postAnalytics returns empty', async () => {
    const r = await provider.postAnalytics('123', 'tok', 'post-456', 7);
    expect(r).toEqual([]);
  });

  it('teams fetches team list from user endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ teams: [{ id: 'team-1', name: 'My Team' }] }));
    const r = await provider.teams('tok');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('team-1');
  });

  it('teams returns empty when no teams', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
    const r = await provider.teams('tok');
    expect(r).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. DISCORD PROVIDER
// ─────────────────────────────────────────────────────────────
describe('discord deep', () => {
  let provider: DiscordProvider;

  beforeEach(() => {
    provider = new DiscordProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 1980', () => {
    expect(provider.maxLength()).toBe(1980);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('50001')?.type).toBe('bad-body');
    expect(provider.handleErrors('50013')?.type).toBe('bad-body');
    expect(provider.handleErrors('10003')?.type).toBe('bad-body');
    expect(provider.handleErrors('40005')?.type).toBe('bad-body');
    expect(provider.handleErrors('20028')?.type).toBe('retry');
    expect(provider.handleErrors('random error')).toBeUndefined();
  });

  it('propagates BadBodyError when post encounters a bad-body error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('50001', 403));
    await expect(provider.post('guild-123', 'tok', [{ id: 'p1', message: 'Hello Discord!', settings: { channel: 'ch-1' }, media: [] }])).rejects.toThrow(BadBodyError);
  });

  it('refreshToken calls token and @me endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', expires_in: 7200, refresh_token: 'new-rtok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ application: { name: 'My App', bot: { id: 'bot-123', username: 'mybot', avatar: 'av123' } } })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.refreshToken).toBe('new-rtok');
    expect(r.name).toBe('My App');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('discord.com/oauth2/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', expires_in: 7200, refresh_token: 'rtok', scope: 'identify guilds', guild: { id: 'guild-123' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ application: { name: 'My App', bot: { id: 'bot-123', username: 'mybot', avatar: 'av123' } } })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('guild-123');
    expect(r.name).toBe('My App');
  });

  it('channels fetches guild channels', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp([
      { id: 'ch-1', name: 'general', type: 0 },
      { id: 'ch-2', name: 'announcements', type: 5 },
      { id: 'ch-3', name: 'forum', type: 15 },
      { id: 'ch-4', name: 'voice', type: 2 },
    ]));
    const r = await provider.channels('tok', {}, 'guild-123');
    expect(r).toHaveLength(3);
    expect(r[0].name).toBe('general');
  });

  it('post sends message without media', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'msg-123' })));
    const r = await provider.post('guild-123', 'tok', [{ id: 'p1', message: 'Hello Discord!', settings: { channel: 'ch-1' }, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('msg-123');
    expect(r[0].releaseURL).toContain('discord.com/channels/');
  });

  it('post sends message with media (downloads each file)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ url: 'https://ex.com/img.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'msg-456' })));
    const r = await provider.post('guild-123', 'tok', [{ id: 'p1', message: 'With image', settings: { channel: 'ch-1' }, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('msg-456');
  });

  it('comment creates thread on first comment', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'comment-msg-123' })));
    const r = await provider.comment('guild-123', 'post-msg-456', undefined, 'tok', [{ id: 'c1', message: 'Reply', settings: { channel: 'ch-1' }, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('comment-msg-123');
  });

  it('comment with lastCommentId uses existing thread', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'nested-msg-123' })));
    const r = await provider.comment('guild-123', 'post-msg-456', 'thread-123', 'tok', [{ id: 'c2', message: 'Nested', settings: { channel: 'ch-1' }, media: [] }], {} as any);
    expect(r[0].postId).toBe('nested-msg-123');
  });

  it('comment downloads media when present', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'comment-media-123' })));
    const r = await provider.comment('guild-123', 'post-msg-456', undefined, 'tok', [{ id: 'c3', message: 'With pic', settings: { channel: 'ch-1' }, media: [{ path: 'https://ex.com/img.jpg' }] }], {} as any);
    expect(r[0].postId).toBe('comment-media-123');
  });

  it('changeNickname patches nickname', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
    const r = await provider.changeNickname('guild-123', 'tok', 'New Nick');
    expect(r.name).toBe('New Nick');
  });

  it('mention searches roles and members', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp([
        { id: 'role-1', name: 'mod' },
        { id: 'role-2', name: 'admin' },
        { id: 'role-3', name: '@everyone' },
      ])))
      .mockImplementationOnce(() => Promise.resolve(resp([
        { user: { id: 'user-1', global_name: 'TestUser', username: 'testuser', avatar: 'av1' } },
      ])));
    const r = await provider.mention('tok', { query: 'test' }, 'guild-123', {} as any);
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((m: any) => m.label === 'TestUser')).toBe(true);
  });

  it('mentionFormat formats correctly', () => {
    expect(provider.mentionFormat('123', 'Test')).toBe('[[[@123]]]');
    expect(provider.mentionFormat('here', '@here')).toBe('@here');
    expect(provider.mentionFormat('everyone', '@everyone')).toBe('@everyone');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. SLACK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('slack deep', () => {
  let provider: SlackProvider;

  beforeEach(() => {
    provider = new SlackProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 400000', () => {
    expect(provider.maxLength()).toBe(400000);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
    expect(r.id).toBe('');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('slack.com/oauth/v2/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', team: { id: 'team-123' }, bot_user_id: 'B123', scope: 'channels:read,chat:write,users:read,groups:read,channels:join,chat:write.customize' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ user: { real_name: 'Slack Bot', name: 'slackbot', profile: { image_original: 'https://ex.com/pic.jpg' } } })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('team-123');
    expect(r.name).toBe('Slack Bot');
  });

  it('channels fetches conversation list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ channels: [{ id: 'C123', name: 'general' }, { id: 'C456', name: 'random' }] }));
    const r = await provider.channels('tok', {}, 'team-123');
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe('C123');
  });

  it('post joins channel, posts message, and gets permalink', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ ok: true })))
      .mockImplementationOnce(() => Promise.resolve(resp({ ts: '1234.5678', channel: 'C123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://slack.com/archives/C123/p1234' })));
    const r = await provider.post('team-123', 'tok', [{ id: 'p1', message: 'Hello Slack!', settings: { channel: 'C123' }, media: [] }], { name: 'My Bot', picture: 'https://ex.com/pic.jpg' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('1234.5678');
    expect(r[0].releaseURL).toContain('slack.com');
  });

  it('post with media includes image blocks', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ ok: true })))
      .mockImplementationOnce(() => Promise.resolve(resp({ ts: '5678.9012', channel: 'C456' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://slack.com/archives/C456/p5678' })));
    const r = await provider.post('team-123', 'tok', [{ id: 'p1', message: 'With image', settings: { channel: 'C456' }, media: [{ path: 'https://ex.com/img.jpg' }] }], { name: 'Bot', picture: '' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('5678.9012');
  });

  it('comment posts threaded reply and gets permalink', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ ts: '9101.1121', channel: 'C123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://slack.com/archives/C123/p9101' })));
    const r = await provider.comment('team-123', '1234.5678', undefined, 'tok', [{ id: 'c1', message: 'Great!', settings: { channel: 'C123' }, media: [] }], { name: 'Bot', picture: '' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('9101.1121');
  });

  it('comment with lastCommentId uses it as thread_ts', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ ts: '9102.1122', channel: 'C123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://slack.com/archives/C123/p9102' })));
    const r = await provider.comment('team-123', '1234.5678', '9101.1121', 'tok', [{ id: 'c2', message: 'Reply chain', settings: { channel: 'C123' }, media: [] }], { name: 'Bot', picture: '' } as any);
    expect(r[0].postId).toBe('9102.1122');
  });

  it('changeProfilePicture returns url', async () => {
    const r = await provider.changeProfilePicture('team-123', 'tok', 'https://ex.com/new-pic.jpg');
    expect(r.url).toBe('https://ex.com/new-pic.jpg');
  });

  it('changeNickname returns name', async () => {
    const r = await provider.changeNickname('team-123', 'tok', 'New Name');
    expect(r.name).toBe('New Name');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. MASTODON PROVIDER
// ─────────────────────────────────────────────────────────────
describe('mastodon deep', () => {
  let provider: MastodonProvider;

  beforeEach(() => {
    provider = new MastodonProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 500', () => {
    expect(provider.maxLength()).toBe(500);
  });

  it('handleErrors returns refresh-token for disabled login', () => {
    const r = provider.handleErrors('Your login is currently disabled');
    expect(r?.type).toBe('refresh-token');
  });

  it('handleErrors returns undefined for other errors', () => {
    expect(provider.handleErrors('random error')).toBeUndefined();
  });

  it('propagates RefreshTokenError when post hits a disabled login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('Your login is currently disabled', 403));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Mastodon!', settings: {}, media: [] }])).rejects.toThrow(RefreshTokenError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('rtok');
    expect(r.accessToken).toBe('');
    expect(r.id).toBe('');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('/oauth/authorize');
    expect(r.url).toContain('client_id');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', display_name: 'Test User', acct: 'testuser@mastodon.social', username: 'testuser', avatar: 'https://ex.com/av.jpg' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
    expect(r.username).toBe('testuser');
  });

  it('uploadFile uploads media and returns id', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ url: 'https://ex.com/img.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-123' })));
    const r = await provider.uploadFile('https://mastodon.social', 'https://ex.com/img.jpg', 'tok', 'alt text');
    expect(r).toBe('media-123');
  });

  it('post without media creates text-only toot', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'status-123' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Mastodon!', settings: {}, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('status-123');
    expect(r[0].releaseURL).toContain('/statuses/status-123');
  });

  it('post with media uploads then toots', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ url: 'https://ex.com/img.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-456' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'status-456' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'With image', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('status-456');
  });

  it('comment creates reply to status', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'comment-123' })));
    const r = await provider.comment('user123', 'status-456', undefined, 'tok', [{ id: 'c1', message: 'Nice toot!', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('comment-123');
  });

  it('comment with media uploads then replies', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ url: 'https://ex.com/img.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-789' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'comment-456' })));
    const r = await provider.comment('user123', 'status-456', undefined, 'tok', [{ id: 'c2', message: 'With pic', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }], {} as any);
    expect(r[0].postId).toBe('comment-456');
  });

  it('comment with lastCommentId replies to that comment', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'nested-comment-123' })));
    const r = await provider.comment('user123', 'status-456', 'comment-123', 'tok', [{ id: 'c3', message: 'Nested', settings: {}, media: [] }], {} as any);
    expect(r[0].postId).toBe('nested-comment-123');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. GMB PROVIDER
// ─────────────────────────────────────────────────────────────
describe('gmb deep', () => {
  let provider: GmbProvider;

  beforeEach(() => {
    provider = new GmbProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 1500', () => {
    expect(provider.maxLength()).toBe(1500);
  });

  it('checkValidity rejects more than one image', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img1.jpg' }, { path: 'https://ex.com/img2.jpg' }]], {});
    expect(r).not.toBe(true);
  });

  it('checkValidity rejects video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]], {});
    expect(r).not.toBe(true);
  });

  it('checkValidity rejects event without title', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]], { topicType: 'EVENT' });
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with valid input', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]], { topicType: 'STANDARD' });
    expect(r).toBe(true);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('UNAUTHENTICATED')?.type).toBe('refresh-token');
    expect(provider.handleErrors('invalid_grant')?.type).toBe('refresh-token');
    expect(provider.handleErrors('Unauthorized')?.type).toBe('refresh-token');
    expect(provider.handleErrors('PERMISSION_DENIED')?.type).toBe('refresh-token');
    expect(provider.handleErrors('NOT_FOUND')?.type).toBe('bad-body');
    expect(provider.handleErrors('INVALID_ARGUMENT')?.type).toBe('bad-body');
    expect(provider.handleErrors('RESOURCE_EXHAUSTED')?.type).toBe('bad-body');
    expect(provider.handleErrors('OK')).toBeUndefined();
  });

  it('propagates RefreshTokenError when post hits an auth error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('UNAUTHENTICATED', 403));
    await expect(provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'Hello GMB!', settings: { topicType: 'STANDARD' }, media: [] }])).rejects.toThrow(RefreshTokenError);
  });

  it('propagates BadBodyError when post hits a not-found error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('NOT_FOUND', 404));
    await expect(provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'Hello GMB!', settings: { topicType: 'STANDARD' }, media: [] }])).rejects.toThrow(BadBodyError);
  });

  it('refreshToken refreshes and returns user info', async () => {
    const r = await provider.refreshToken('gmb-rtok');
    expect(r.accessToken).toBe('new-gmb-tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('accounts.google.com/o/oauth2/auth');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('gmb-tok');
    expect(r.refreshToken).toBe('gmb-rtok');
    expect(r.id).toBe('123');
  });

  it('pages fetches accounts and locations', async () => {
    const accountsResp = resp({ accounts: [{ name: 'accounts/123' }] });
    const locationsResp = resp({ locations: [{ name: 'locations/456', title: 'My Store' }] });
    const mediaResp = resp({ mediaItems: [{ mediaFormat: 'PHOTO', locationAssociation: { category: 'PROFILE' }, googleUrl: 'https://ex.com/store.jpg' }] });
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(accountsResp))
      .mockImplementationOnce(() => Promise.resolve(locationsResp))
      .mockImplementationOnce(() => Promise.resolve(mediaResp));
    const r = await provider.pages('tok');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('My Store');
    expect(r[0].id).toBe('accounts/123/locations/456');
  });

  it('pages returns empty when no accounts', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
    const r = await provider.pages('tok');
    expect(r).toEqual([]);
  });

  it('fetchPageInformation fetches location details', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'locations/456', title: 'My Store' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ mediaItems: [{ mediaFormat: 'PHOTO', locationAssociation: { category: 'PROFILE' }, googleUrl: 'https://ex.com/store.jpg' }] })));
    const r = await provider.fetchPageInformation('tok', { id: 'accounts/123/locations/456', accountName: 'accounts/123', locationName: 'locations/456' });
    expect(r.id).toBe('accounts/123/locations/456');
    expect(r.name).toBe('My Store');
  });

  it('reConnect finds and reconnects location', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ accounts: [{ name: 'accounts/123' }] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ locations: [{ name: 'locations/456', title: 'My Store' }] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ mediaItems: [] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'locations/456', title: 'My Store', metadata: {} })))
      .mockImplementationOnce(() => Promise.resolve(resp({ mediaItems: [] })));
    const r = await provider.reConnect('123', 'accounts/123/locations/456', 'tok');
    expect(r.id).toBe('accounts/123/locations/456');
    expect(r.name).toBe('My Store');
  });

  it('post creates local post', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ name: 'accounts/123/locations/456/localPosts/789' }));
    const r = await provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'Hello GMB!', settings: { topicType: 'STANDARD' }, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('accounts/123/locations/456/localPosts/789');
  });

  it('post with image media', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ name: 'accounts/123/locations/456/localPosts/790' }));
    const r = await provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'With image', settings: { topicType: 'STANDARD' }, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }]);
    expect(r[0].postId).toBe('accounts/123/locations/456/localPosts/790');
  });

  it('post with call to action', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ name: 'accounts/123/locations/456/localPosts/791' }));
    const r = await provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'CTA post', settings: { topicType: 'STANDARD', callToActionType: 'LEARN_MORE', callToActionUrl: 'https://ex.com' }, media: [] }]);
    expect(r[0].postId).toBe('accounts/123/locations/456/localPosts/791');
  });

  it('post with event settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ name: 'accounts/123/locations/456/localPosts/792' }));
    const r = await provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'Event post', settings: { topicType: 'EVENT', eventTitle: 'Grand Opening', eventStartDate: '2024-06-01', eventEndDate: '2024-06-02' }, media: [] }]);
    expect(r[0].postId).toBe('accounts/123/locations/456/localPosts/792');
  });

  it('post with offer settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ name: 'accounts/123/locations/456/localPosts/793' }));
    const r = await provider.post('accounts/123/locations/456', 'tok', [{ id: 'p1', message: 'Offer post', settings: { topicType: 'OFFER', offerCouponCode: 'SAVE20', offerRedeemUrl: 'https://ex.com/redeem', offerTerms: 'Terms apply' }, media: [] }]);
    expect(r[0].postId).toBe('accounts/123/locations/456/localPosts/793');
  });

  it('analytics fetches performance metrics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: [{
          dailyMetric: 'WEBSITE_CLICKS',
          timeSeries: { datedValues: [{ value: '10', date: { year: 2024, month: 1, day: 1 } }, { value: '20', date: { year: 2024, month: 1, day: 2 } }] },
        }, {
          dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
          timeSeries: { datedValues: [{ value: '100', date: { year: 2024, month: 1, day: 1 } }] },
        }],
      }],
    }));
    const r = await provider.analytics('accounts/123/locations/456', 'tok', 7);
    expect(r).toHaveLength(2);
    expect(r[0].label).toBe('Website Clicks');
    expect(r[0].data).toHaveLength(2);
  });

  it('analytics returns empty when no data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
    const r = await provider.analytics('accounts/123/locations/456', 'tok', 7);
    expect(r).toEqual([]);
  });

  it('analytics returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.analytics('accounts/123/locations/456', 'tok', 7);
    expect(r).toEqual([]);
  });

  it('postAnalytics returns empty', async () => {
    const r = await provider.postAnalytics('123', 'tok', 'post-456', 7);
    expect(r).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. VK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('vk deep', () => {
  let provider: VkProvider;

  beforeEach(() => {
    provider = new VkProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 2048', () => {
    expect(provider.maxLength()).toBe(2048);
  });

  it('refreshToken refreshes and returns user info', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', refresh_token: 'new-rtok', expires_in: 86400 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ user: { user_id: '123', first_name: 'Test', last_name: 'User', avatar: 'https://ex.com/av.jpg' } })));
    const r = await provider.refreshToken('old-rtok&&&&device-1');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('id.vk.com/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', scope: 'wall photos video', refresh_token: 'rtok', expires_in: 86400 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ user: { user_id: '123', first_name: 'Test', last_name: 'User', avatar: 'https://ex.com/av.jpg' } })));
    const r = await provider.authenticate({ code: 'auth-code&&&&device-1', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
  });

  it('post without media creates wall post', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { post_id: 123 } })));
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Hello VK!', settings: {}, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('123');
  });

  it('post with image uploads and posts to wall', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { upload_url: 'https://upload.vk.com/photo' } }))) // getWallUploadServer
      .mockImplementationOnce(() => Promise.resolve(resp({}))) // media download
      .mockImplementationOnce(() => Promise.resolve(resp({ photo: 'photo-data', server: 'srv-1', hash: 'hash-1' }))) // upload to VK
      .mockImplementationOnce(() => Promise.resolve(resp({ response: [{ id: 'photo-123' }] }))) // photos.saveWallPhoto
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { post_id: 456 } }))); // wall.post
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'With image', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('456');
  });

  it('post with video uploads via video.save', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { video_id: 'vid-123', upload_url: 'https://upload.vk.com/video' } }))) // video.save
      .mockImplementationOnce(() => Promise.resolve(resp({}))) // media download
      .mockImplementationOnce(() => Promise.resolve(resp({}))) // upload to VK
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { post_id: 789 } }))); // wall.post
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'With video', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }]);
    expect(r[0].postId).toBe('789');
  });

  it('comment creates wall comment', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { comment_id: 999 } })));
    const r = await provider.comment('123', 'post-456', undefined, 'tok', [{ id: 'c1', message: 'Nice post!', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('999');
  });

  it('comment with media uploads then replies', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { upload_url: 'https://upload.vk.com/photo2' } }))) // getWallUploadServer
      .mockImplementationOnce(() => Promise.resolve(resp({}))) // media download
      .mockImplementationOnce(() => Promise.resolve(resp({ photo: 'photo-data', server: 'srv-2', hash: 'hash-2' }))) // upload to VK
      .mockImplementationOnce(() => Promise.resolve(resp({ response: [{ id: 'photo-456' }] }))) // photos.saveWallPhoto
      .mockImplementationOnce(() => Promise.resolve(resp({ response: { comment_id: 888 } }))); // wall.createComment
    const r = await provider.comment('123', 'post-456', undefined, 'tok', [{ id: 'c2', message: 'With pic', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }], {} as any);
    expect(r[0].postId).toBe('888');
  });
});

// ─────────────────────────────────────────────────────────────
// 8. WHOP PROVIDER
// ─────────────────────────────────────────────────────────────
describe('whop deep', () => {
  let provider: WhopProvider;

  beforeEach(() => {
    provider = new WhopProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 50000', () => {
    expect(provider.maxLength()).toBe(50000);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('invalid_grant')?.type).toBe('refresh-token');
    expect(provider.handleErrors('insufficient_scope')?.type).toBe('refresh-token');
    expect(provider.handleErrors('invalid_request')?.type).toBe('bad-body');
    expect(provider.handleErrors('not_found')?.type).toBe('bad-body');
    expect(provider.handleErrors('ok')).toBeUndefined();
  });

  it('propagates RefreshTokenError when post hits an invalid_grant error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('invalid_grant', 403));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Whop!', settings: { experience: 'exp-1' }, media: [] }], {} as any)).rejects.toThrow(RefreshTokenError);
  });

  it('propagates BadBodyError when post hits an invalid_request error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('invalid_request', 400));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Whop!', settings: { experience: 'exp-1' }, media: [] }], {} as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken calls token and userinfo endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', refresh_token: 'new-rtok', expires_in: 3600 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ sub: '123', name: 'Test User', preferred_username: 'testuser', picture: 'https://ex.com/pic.jpg' })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('api.whop.com/oauth/authorize');
    expect(r.url).toContain('code_challenge');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', refresh_token: 'rtok', expires_in: 3600 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ sub: '123', name: 'Test User', preferred_username: 'testuser', picture: 'https://ex.com/pic.jpg' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
  });

  it('authenticate returns error string on failure', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ error: 'invalid_grant', error_description: 'Token expired' })));
    const r = await provider.authenticate({ code: 'bad-code', codeVerifier: 'v' });
    expect(typeof r).toBe('string');
    expect(r).toContain('Authentication failed');
  });

  it('companies fetches company list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [{ id: 'comp-1', title: 'Acme Corp' }] }));
    const r = await provider.companies('tok', {}, '');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('comp-1');
  });

  it('companies returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.companies('tok', {}, '');
    expect(r).toEqual([]);
  });

  it('experiences fetches forum list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [{ experience: { id: 'exp-1', name: 'My Forum' } }] }));
    const r = await provider.experiences('tok', { id: 'comp-1' }, '');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('exp-1');
  });

  it('experiences returns empty without params.id', async () => {
    const r = await provider.experiences('tok', {}, '');
    expect(r).toEqual([]);
  });

  it('experiences returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.experiences('tok', { id: 'comp-1' }, '');
    expect(r).toEqual([]);
  });

  it('post without media creates forum post', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'forum-post-123' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Whop!', settings: { experience: 'exp-1' }, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('forum-post-123');
    expect(r[0].releaseURL).toContain('whop.com/experiences/');
  });

  it('post with media uploads files then creates post', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'file-123', upload_url: 'https://upload.whop.com/file', upload_headers: { 'x-amz-acl': 'public-read' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ upload_status: 'ready' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'forum-post-456' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'With file', settings: { experience: 'exp-1' }, media: [{ path: 'https://ex.com/file.pdf' }] }], {} as any);
    expect(r[0].postId).toBe('forum-post-456');
  });

  it('post with title includes it in request', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'forum-post-789' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'With title', settings: { experience: 'exp-1', title: 'My Post Title' }, media: [] }], {} as any);
    expect(r[0].postId).toBe('forum-post-789');
  });

  it('comment creates forum reply', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'forum-reply-123' })));
    const r = await provider.comment('user123', 'forum-post-123', undefined, 'tok', [{ id: 'c1', message: 'Great post!', settings: { experience: 'exp-1' }, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('forum-reply-123');
  });

  it('comment with lastCommentId uses it as parent_id', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'forum-reply-456' })));
    const r = await provider.comment('user123', 'forum-post-123', 'existing-comment', 'tok', [{ id: 'c2', message: 'Nested reply', settings: { experience: 'exp-1' }, media: [] }], {} as any);
    expect(r[0].postId).toBe('forum-reply-456');
  });

  it('comment with media uploads files then replies', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'file-456', upload_url: 'https://upload.whop.com/file2', upload_headers: {} })))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ upload_status: 'ready' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'forum-reply-789' })));
    const r = await provider.comment('user123', 'forum-post-123', undefined, 'tok', [{ id: 'c3', message: 'With attachment', settings: { experience: 'exp-1' }, media: [{ path: 'https://ex.com/file.pdf' }] }], {} as any);
    expect(r[0].postId).toBe('forum-reply-789');
  });
});

// ─────────────────────────────────────────────────────────────
// 9. MEWE PROVIDER
// ─────────────────────────────────────────────────────────────
describe('mewe deep', () => {
  let provider: MeweProvider;

  beforeEach(() => {
    provider = new MeweProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 63206', () => {
    expect(provider.maxLength()).toBe(63206);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('Unauthorized')?.type).toBe('refresh-token');
    expect(provider.handleErrors('Enhance Your Calm')?.type).toBe('retry');
    expect(provider.handleErrors('420')?.type).toBe('retry');
    expect(provider.handleErrors('Forbidden')?.type).toBe('bad-body');
    expect(provider.handleErrors('OK')).toBeUndefined();
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
    expect(r.id).toBe('');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('/login');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges login request token for api token', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ apiToken: 'api-tok-123', expiresAt: '2025-01-01T00:00:00Z' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ userId: 'user-123', name: 'Test User', handle: 'testuser' })));
    const r = await provider.authenticate({ code: 'login-request-tok', codeVerifier: 'v' });
    expect(r.accessToken).toBe('api-tok-123');
    expect(r.id).toBe('user-123');
    expect(r.name).toBe('Test User');
    expect(r.username).toBe('testuser');
  });

  it('authenticate returns error on missing code', async () => {
    const r = await provider.authenticate({ code: '', codeVerifier: 'v' });
    expect(typeof r).toBe('string');
  });

  it('authenticate returns error on failed token exchange', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
    const r = await provider.authenticate({ code: 'bad-token', codeVerifier: 'v' });
    expect(typeof r).toBe('string');
  });

  it('authenticate returns pending message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ pending: true }));
    const r = await provider.authenticate({ code: 'pending-token', codeVerifier: 'v' });
    expect(typeof r).toBe('string');
    expect(r).toContain('pending');
  });

  it('authenticate returns error when no apiToken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ apiToken: '' }));
    const r = await provider.authenticate({ code: 'no-token', codeVerifier: 'v' });
    expect(typeof r).toBe('string');
  });

  it('authenticate returns error on failed profile fetch', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ apiToken: 'tok', expiresAt: '2025-01-01T00:00:00Z' })))
      .mockImplementationOnce(() => Promise.resolve({ status: 401, ok: false, json: vi.fn(), text: vi.fn(), blob: vi.fn(), arrayBuffer: vi.fn(), headers: new Map() } as any));
    const r = await provider.authenticate({ code: 'tok', codeVerifier: 'v' });
    expect(typeof r).toBe('string');
  });

  it('groups fetches group list with pagination', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ groups: [{ groupId: 'group-1', name: 'My Group' }] }));
    const r = await provider.groups('tok', {}, 'user-123', {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('group-1');
  });

  it('post to group uploads photos and creates post', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'photo-uploaded-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const r = await provider.post('user-123', 'tok', [{ id: 'p1', message: 'Hello MeWe!', settings: { postType: 'group', group: 'group-1' }, media: [{ path: 'https://ex.com/img.jpg' }] }], { profile: 'testuser' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBeDefined();
    expect(r[0].releaseURL).toContain('mewe.com/group/');
  });

  it('post to timeline creates post on timeline', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const r = await provider.post('user-123', 'tok', [{ id: 'p1', message: 'Timeline post', settings: { postType: 'timeline' }, media: [] }], { profile: 'testuser' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].releaseURL).toContain('mewe.com');
  });

  it('post without media creates post without photo upload', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const r = await provider.post('user-123', 'tok', [{ id: 'p1', message: 'Text only', settings: { postType: 'group', group: 'group-1' }, media: [] }], { profile: 'testuser' } as any);
    expect(r).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. KICK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('kick deep', () => {
  let provider: KickProvider;

  beforeEach(() => {
    provider = new KickProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 500', () => {
    expect(provider.maxLength()).toBe(500);
  });

  it('refreshToken calls token and user endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', refresh_token: 'new-rtok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ user_id: 123, name: 'testuser', profile_picture: 'https://ex.com/pic.jpg' }] })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.username).toBe('testuser');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('id.kick.com/oauth/authorize');
    expect(r.url).toContain('code_challenge');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', refresh_token: 'rtok', expires_in: 7200, scope: 'chat:write user:read channel:read' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ user_id: 456, name: 'kickuser', profile_picture: 'https://ex.com/pic.jpg' }] })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'cv' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('456');
    expect(r.username).toBe('kickuser');
  });

  it('post sends chat message', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { message_id: 'msg-123', is_sent: true } })));
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Hello Kick!', settings: {}, media: [] }], { profile: 'kickchannel' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('msg-123');
    expect(r[0].status).toBe('posted');
  });

  it('post returns error status when not sent', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { message_id: 'msg-456', is_sent: false } })));
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Failed message', settings: {}, media: [] }], { profile: 'ch' } as any);
    expect(r[0].status).toBe('error');
  });

  it('comment sends reply message', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { message_id: 'reply-123', is_sent: true } })));
    const r = await provider.comment('123', 'msg-456', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], { profile: 'ch' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('reply-123');
  });

  it('comment with lastCommentId uses reply_to_message_id', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { message_id: 'nested-123', is_sent: true } })));
    const r = await provider.comment('123', 'msg-456', 'reply-123', 'tok', [{ id: 'c2', message: 'Nested', settings: {}, media: [] }], { profile: 'ch' } as any);
    expect(r[0].postId).toBe('nested-123');
  });
});

// ─────────────────────────────────────────────────────────────
// 11. TWITCH PROVIDER
// ─────────────────────────────────────────────────────────────
describe('twitch deep', () => {
  let provider: TwitchProvider;

  beforeEach(() => {
    provider = new TwitchProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 500', () => {
    expect(provider.maxLength()).toBe(500);
  });

  it('refreshToken calls token and users endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', refresh_token: 'new-rtok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ id: '123', display_name: 'TestUser', login: 'testuser', profile_image_url: 'https://ex.com/pic.jpg' }] })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.username).toBe('testuser');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('id.twitch.tv/oauth2/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', refresh_token: 'rtok', expires_in: 7200, scope: 'user:write:chat user:read:chat moderator:manage:announcements' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ id: '456', display_name: 'Streamer', login: 'streamer', profile_image_url: 'https://ex.com/pic.jpg' }] })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('456');
    expect(r.name).toBe('Streamer');
  });

  it('post sends chat message', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ message_id: 'msg-123', is_sent: true }] })));
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Hello Twitch!', settings: { messageType: 'message' }, media: [] }], { profile: 'streamer' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('msg-123');
    expect(r[0].status).toBe('posted');
  });

  it('post sends announcement', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Announcement!', settings: { messageType: 'announcement', announcementColor: 'purple' }, media: [] }], { profile: 'streamer' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('posted');
  });

  it('post returns error when message not sent', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ message_id: 'msg-456', is_sent: false }] })));
    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Failed', settings: { messageType: 'message' }, media: [] }], { profile: 's' } as any);
    expect(r[0].status).toBe('error');
  });

  it('comment sends chat reply', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ message_id: 'reply-123', is_sent: true }] })));
    const r = await provider.comment('123', 'msg-456', undefined, 'tok', [{ id: 'c1', message: 'Great stream!', settings: { messageType: 'message' }, media: [] }], { profile: 'streamer' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('reply-123');
  });

  it('comment with lastCommentId includes reply_parent_message_id', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ message_id: 'nested-123', is_sent: true }] })));
    const r = await provider.comment('123', 'msg-456', 'reply-123', 'tok', [{ id: 'c2', message: 'Nested reply', settings: { messageType: 'message' }, media: [] }], { profile: 'streamer' } as any);
    expect(r[0].postId).toBe('nested-123');
  });

  it('comment sends announcement', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const r = await provider.comment('123', 'msg-456', undefined, 'tok', [{ id: 'c3', message: 'Announce reply', settings: { messageType: 'announcement' }, media: [] }], { profile: 'streamer' } as any);
    expect(r[0].status).toBe('posted');
  });
});
