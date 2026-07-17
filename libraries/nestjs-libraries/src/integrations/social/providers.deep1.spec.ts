import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('form-data', () => ({ default: class FormData { append = vi.fn(); } }));
vi.mock('image-to-pdf', () => ({ default: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn((e: string, cb: any) => { if (e === 'data') cb(Buffer.from('pdf')); if (e === 'end') cb(); }) })) }));

const mockYtClient = vi.hoisted(() => ({
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=abc123'),
  getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'tok', refresh_token: 'rtok', expiry_date: Date.now() + 3600000 } }),
  setCredentials: vi.fn(),
  getTokenInfo: vi.fn().mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtubepartner', 'https://www.googleapis.com/auth/yt-analytics.readonly'] }),
  refreshAccessToken: vi.fn().mockResolvedValue({ credentials: { access_token: 'new-tok', refresh_token: 'rtok', expiry_date: Date.now() + 3600000 } }),
}));
const mockYtVideos = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue({ data: { id: 'video-123' } }), list: vi.fn().mockResolvedValue({ data: { items: [{ statistics: { viewCount: '100', likeCount: '50', commentCount: '10', favoriteCount: '5' } }] } }) }));
const mockYtChannels = vi.hoisted(() => ({ list: vi.fn().mockResolvedValue({ data: { items: [{ id: 'ch-123', snippet: { title: 'My Channel', thumbnails: { default: { url: 'https://ex.com/ch.jpg' } }, customUrl: '@mychannel' }, statistics: { subscriberCount: '1000' } }] } }) }));
const mockYtThumbnails = vi.hoisted(() => ({ set: vi.fn().mockResolvedValue({}) }));
const mockYtOauth2 = vi.hoisted(() => ({ userinfo: { get: vi.fn().mockResolvedValue({ data: { id: '123', name: 'Test User', picture: 'https://ex.com/pic.jpg' } }) } }));
const mockYtAnalytics = vi.hoisted(() => ({ reports: { query: vi.fn().mockResolvedValue({ data: { columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }, { name: 'likes' }, { name: 'subscribersLost' }], rows: [['2024-01-01', 100, 50, 30, 25, 5, 10, 2]] } }) } }));

vi.mock('googleapis', () => {
  const yt = { videos: mockYtVideos, channels: mockYtChannels, thumbnails: mockYtThumbnails };
  return {
    google: {
      auth: { OAuth2: vi.fn(function() { return mockYtClient; }) },
      youtube: vi.fn(() => yt),
      oauth2: vi.fn(function() { return mockYtOauth2; }),
      youtubeAnalytics: vi.fn(function() { return mockYtAnalytics; }),
    },
  };
});

process.env.FRONTEND_URL = 'https://app.example.com';

import { RefreshTokenError, BadBodyError } from '@gitroom/nestjs-libraries/inngest/errors';
import { XProvider } from './x.provider';
import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { YoutubeProvider } from './youtube.provider';
import { TiktokProvider } from './tiktok.provider';
import { LinkedinProvider } from './linkedin.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { RedditProvider } from './reddit.provider';
import { PinterestProvider } from './pinterest.provider';
import { ThreadsProvider } from './threads.provider';

function resp(data: any) {
  return {
    status: 200, ok: true,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify(data)])),
    headers: new Map([['x-restli-id', 'urn:li:post:abc'], ['get', (k: string) => k === 'x-restli-id' ? 'urn:li:post:abc' : undefined]]),
  };
}

function respCreated() {
  return {
    status: 201, ok: true,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue('{}'),
    headers: new Map([['x-restli-id', 'urn:li:post:abc'], ['get', (k: string) => k === 'x-restli-id' ? 'urn:li:post:abc' : undefined]]),
  };
}

function respEtag() {
  return {
    status: 200, ok: true,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue('{}'),
    headers: new Map([['etag', '"etag-123"'], ['get', (k: string) => k === 'etag' ? '"etag-123"' : undefined]]),
  };
}

function respError(body: string, status: number) {
  return {
    status, ok: false,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
    headers: new Map(),
  };
}

// ─────────────────────────────────────────────────────────────
// 1. X PROVIDER
// ─────────────────────────────────────────────────────────────
describe('x deep', () => {
  let provider: XProvider;

  beforeEach(() => {
    provider = new XProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength - normal', () => {
    expect(provider.maxLength(false)).toBe(280);
  });

  it('maxLength - premium/verified', () => {
    expect(provider.maxLength(true)).toBe(4000);
    expect(provider.maxLength([{ title: 'Verified', value: true }])).toBe(4000);
    expect(provider.maxLength([{ title: 'Other', value: false }])).toBe(280);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('You are not permitted to perform this action')?.type).toBe('bad-body');
    expect(provider.handleErrors('Service Unavailable')?.type).toBe('retry');
    expect(provider.handleErrors('maximum of one cashtag')?.type).toBe('bad-body');
    expect(provider.handleErrors('maximum of 4 items')?.type).toBe('bad-body');
    expect(provider.handleErrors('Unsupported Authentication')?.type).toBe('refresh-token');
    expect(provider.handleErrors('You are not allowed to create a Tweet')?.type).toBe('bad-body');
    expect(provider.handleErrors('usage-capped')?.type).toBe('bad-body');
    expect(provider.handleErrors('user-suspended')?.type).toBe('bad-body');
    expect(provider.handleErrors('duplicate-rules')?.type).toBe('bad-body');
    expect(provider.handleErrors('Your account is not permitted to access this feature')?.type).toBe('bad-body');
    expect(provider.handleErrors('The Tweet contains an invalid URL.')?.type).toBe('bad-body');
    expect(provider.handleErrors('This user is not allowed to post a video longer than 2 minutes')?.type).toBe('bad-body');
    expect(provider.handleErrors('random text')).toBeUndefined();
  });

  it('throws RefreshTokenError on Unsupported Authentication', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('Unsupported Authentication', 400));
    await expect(provider.post('123', 'at:as', [{ id: 'p1', message: 'Hello world', settings: {}, media: [] }], { profile: 'testuser' } as any)).rejects.toThrow(RefreshTokenError);
  });

  it('throws BadBodyError on not-permitted error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('You are not permitted to perform this action', 400));
    await expect(provider.post('123', 'at:as', [{ id: 'p1', message: 'Hello world', settings: {}, media: [] }], { profile: 'testuser' } as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken();
    expect(r.accessToken).toBe('');
    expect(r.id).toBe('');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toContain('x.com');
  });

  it('authenticate exchanges code for tokens', async () => {
    const r = await provider.authenticate({ code: 'auth-code', codeVerifier: 'tok:sec' });
    expect(r.id).toBe('123');
    expect(r.accessToken).toContain(':');
    expect(r.name).toBe('Test User');
    expect(r.username).toBe('testuser');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
    expect(r.additionalSettings).toHaveLength(1);
    expect(r.additionalSettings[0].value).toBe(true);
  });

  it('post without media', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'tweet-123' } }));
    const result = await provider.post('123', 'at:as', [{ id: 'p1', message: 'Hello world', settings: {}, media: [] }], { profile: 'testuser' } as any);
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('tweet-123');
    expect(result[0].releaseURL).toContain('twitter.com');
  });

  it('post with media', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'tweet-456' } }));
    const result = await provider.post('123', 'at:as', [{ id: 'p1', message: 'With media', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], { profile: 'testuser' } as any);
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('tweet-456');
  });

  it('post with community and reply settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'tweet-789' } }));
    const result = await provider.post('123', 'at:as', [{ id: 'p1', message: 'Community post', settings: { community: '123/community456', who_can_reply_post: 'following', made_with_ai: true, paid_partnership: true }, media: [] }], { profile: 'testuser' } as any);
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('tweet-789');
  });

  it('comment replies to a post', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'reply-123' } }));
    const result = await provider.comment('123', 'parent-post', undefined, 'at:as', [{ id: 'c1', message: 'Great post!', settings: {}, media: [] }], { profile: 'testuser' } as any);
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('reply-123');
  });

  it('comment with lastCommentId', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'reply-456' } }));
    const result = await provider.comment('123', 'parent-post', 'existing-comment', 'at:as', [{ id: 'c2', message: 'Reply chain', settings: {}, media: [] }], { profile: 'testuser' } as any);
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('reply-456');
  });

  it('analytics returns metrics', async () => {
    const result = await provider.analytics('123', 'at:as', 30);
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
    const labels = result.map(r => r.label);
    expect(labels).toContain('IMPRESSION');
    expect(labels).toContain('LIKE');
  });

  it('analytics returns empty when DISABLE_X_ANALYTICS is set', async () => {
    process.env.DISABLE_X_ANALYTICS = 'true';
    const result = await provider.analytics('123', 'at:as', 30);
    expect(result).toEqual([]);
    delete process.env.DISABLE_X_ANALYTICS;
  });

  it('analytics returns empty when no tweets found', async () => {
    const result = await provider.analytics('123', 'at:as', 200);
    expect(result).toBeInstanceOf(Array);
  });

  it('postAnalytics returns metrics', async () => {
    const result = await provider.postAnalytics('123', 'at:as', 'post-456', 30);
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.label === 'Impressions')).toBe(true);
    expect(result.some(r => r.label === 'Likes')).toBe(true);
    expect(result.some(r => r.label === 'Retweets')).toBe(true);
    expect(result.some(r => r.label === 'Replies')).toBe(true);
    expect(result.some(r => r.label === 'Quotes')).toBe(true);
    expect(result.some(r => r.label === 'Bookmarks')).toBe(true);
  });

  it('postAnalytics returns empty when disabled', async () => {
    process.env.DISABLE_X_ANALYTICS = 'true';
    const result = await provider.postAnalytics('123', 'at:as', 'post-456', 30);
    expect(result).toEqual([]);
    delete process.env.DISABLE_X_ANALYTICS;
  });

  it('mention finds users', async () => {
    const result = await provider.mention('at:as', { query: 'testuser' });
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('testuser');
    expect(result![0].label).toBe('Test');
  });

  it('mention returns empty when user not found', async () => {
    const result = await provider.mention('at:as', { query: 'nonexistent' });
    expect(result).toBeInstanceOf(Array);
  });

  it('mentionFormat formats correctly', () => {
    expect(provider.mentionFormat('testuser', 'Test User')).toBe('@testuser');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. FACEBOOK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('facebook deep', () => {
  let provider: FacebookProvider;

  beforeEach(() => {
    provider = new FacebookProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 63206', () => {
    expect(provider.maxLength()).toBe(63206);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('Error validating access token', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('REVOKED_ACCESS_TOKEN', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('1366046', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1390008', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1346003', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1404006', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2069019', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1404102', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1404078', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('1366051', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1609008', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2061006', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1349125', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1404112', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('Name parameter too long', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1363047', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('1609010', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('4854002', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('(#100) No permission to publish the video', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('490', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('anything', 401)?.type).toBe('bad-body');
    expect(provider.handleErrors('ok', 200)).toBeUndefined();
  });

  it('throws RefreshTokenError on access token validation error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('Error validating access token', 400));
    await expect(provider.post('page-123', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }])).rejects.toThrow(RefreshTokenError);
  });

  it('throws BadBodyError on error code 1366046', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('1366046', 400));
    await expect(provider.post('page-123', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }])).rejects.toThrow(BadBodyError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('facebook.com');
    expect(r.url).toContain('dialog/oauth');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate calls token endpoints sequentially', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'short-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'long-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_manage_posts', status: 'granted' }, { permission: 'pages_manage_engagement', status: 'granted' }, { permission: 'pages_read_engagement', status: 'granted' }, { permission: 'read_insights', status: 'granted' }, { permission: 'business_management', status: 'granted' }] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', name: 'Test', picture: { data: { url: 'https://ex.com/pic.jpg' } } })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.id).toBe('123');
    expect(r.accessToken).toBe('long-tok');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
  });

  it('post without media', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'post-123', permalink_url: 'https://fb.com/p/123' }));
    const result = await provider.post('page-123', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }]);
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('post-123');
  });

  it('post with images', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'photo-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'photo-2' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'post-456', permalink_url: 'https://fb.com/p/456' })));
    const result = await provider.post('page-123', 'tok', [{ id: 'p1', message: 'With images', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img1.jpg' }, { type: 'image', path: 'https://ex.com/img2.jpg' }] }]);
    expect(result).toHaveLength(1);
  });

  it('post with video', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'vid-123', permalink_url: 'https://fb.com/v/123' }));
    const result = await provider.post('page-123', 'tok', [{ id: 'p1', message: 'Video post', settings: {}, media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }] }]);
    expect(result[0].postId).toBe('vid-123');
    expect(result[0].releaseURL).toContain('facebook.com/reel/');
  });

  it('post story with photo', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'photo-story' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ post_id: 'story-123' })));
    const result = await provider.post('page-123', 'tok', [{ id: 'p1', message: 'Story', settings: { post_type: 'story' }, media: [{ type: 'image', path: 'https://ex.com/story.jpg' }] }]);
    expect(result[0].postId).toBe('story-123');
    expect(result[0].releaseURL).toContain('facebook.com/stories/');
  });

  it('post story with video', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ video_id: 'vid-story', upload_url: 'https://upload.ex.com/vid' })))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: { video_status: 'ready' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ post_id: 'story-vid-123' })));
    const result = await provider.post('page-123', 'tok', [{ id: 'p1', message: 'Video story', settings: { post_type: 'story' }, media: [{ type: 'video', path: 'https://ex.com/story.mp4' }] }]);
    expect(result[0].postId).toBe('story-vid-123');
  });

  it('comment adds comment', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'comment-123', permalink_url: 'https://fb.com/p/123_comment' }));
    const result = await provider.comment('page-123', 'post-123', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], {} as any);
    expect(result[0].postId).toBe('comment-123');
  });

  it('analytics fetches insights', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      data: [
        { name: 'page_impressions_unique', values: [{ value: 100, end_time: '2024-01-02T00:00:00+0000' }] },
        { name: 'page_post_engagements', values: [{ value: 50, end_time: '2024-01-02T00:00:00+0000' }] },
      ],
    }));
    const r = await provider.analytics('page-123', 'tok', 7);
    expect(r).toHaveLength(2);
    expect(r[0].label).toBe('Page Impressions');
  });

  it('postAnalytics fetches post insights', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      data: [
        { name: 'post_impressions_unique', values: [{ value: 500 }] },
        { name: 'post_clicks', values: [{ value: 50 }] },
        { name: 'post_reactions_by_type_total', values: [{ value: { like: 10, love: 5 } }] },
        { name: 'post_clicks_by_type', values: [{ value: { link_click: 20, other_click: 5 } }] },
      ],
    }));
    const r = await provider.postAnalytics('page-123', 'tok', 'post-456', 7);
    expect(r).toHaveLength(4);
    expect(r[0].label).toBe('Impressions');
  });

  it('postAnalytics returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.postAnalytics('page-123', 'tok', 'post-456', 7);
    expect(r).toEqual([]);
  });

  it('reConnect finds page information', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ id: 'page-123', name: 'My Page', access_token: 'page-tok', picture: { data: { url: 'https://ex.com/page.jpg' } }, username: 'mypage' }], paging: { next: undefined } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [], paging: { next: undefined } })));
    const r = await provider.reConnect('123', 'page-123', 'tok');
    expect(r.id).toBe('page-123');
  });

  it('fetchPageInformation finds page from accounts', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ id: 'page-123', name: 'My Page', access_token: 'page-tok', picture: { data: { url: 'https://ex.com/page.jpg' } }, username: 'mypage' }], paging: { next: undefined } })));
    const r = await provider.fetchPageInformation('tok', { page: 'page-123' });
    expect(r.id).toBe('page-123');
    expect(r.access_token).toBe('page-tok');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. INSTAGRAM PROVIDER (via Facebook)
// ─────────────────────────────────────────────────────────────
describe('instagram deep', () => {
  let provider: InstagramProvider;

  beforeEach(() => {
    provider = new InstagramProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 2200', () => {
    expect(provider.maxLength()).toBe(2200);
  });

  it('checkValidity rejects without media', async () => {
    const r = await provider.checkValidity([[]], {});
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with media', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]], {});
    expect(r).toBe(true);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('An unknown error occurred', 500)?.type).toBe('retry');
    expect(provider.handleErrors('2207081', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('REVOKED_ACCESS_TOKEN', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('"error_subcode":33', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('the user is not an instagram business', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('session has been invalidated', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('2207050', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207003', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207020', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207032', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207053', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207052', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207057', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207026', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207023', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207006', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207008', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207028', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207010', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207035', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207036', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207037', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207040', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207004', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207005', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207009', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('Page request limit reached', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207042', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('Not enough permissions to post', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('36003', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('190,', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('36001', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207051', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207001', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207082', 400)?.type).toBe('retry');
    expect(provider.handleErrors('2207077', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('too little or too many attachments', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('2207027', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('param collaborators is not allowed', 400)?.type).toBe('bad-body');
  });

  it('propagates RefreshTokenError when fetch encounters a refresh-token error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('REVOKED_ACCESS_TOKEN', 401));
    await expect(provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'x', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], {} as any)).rejects.toThrow(RefreshTokenError);
  });

  it('propagates BadBodyError when fetch encounters a bad-body error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('2207081', 400));
    await expect(provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'x', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], {} as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('facebook.com');
    expect(r.url).toContain('dialog/oauth');
  });

  it('authenticate calls token endpoints', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'short-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'long-tok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ permission: 'instagram_basic', status: 'granted' }, { permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_read_engagement', status: 'granted' }, { permission: 'business_management', status: 'granted' }, { permission: 'instagram_content_publish', status: 'granted' }, { permission: 'instagram_manage_comments', status: 'granted' }, { permission: 'instagram_manage_insights', status: 'granted' }] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', name: 'Test', picture: { data: { url: 'https://ex.com/pic.jpg' } } })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v', refresh: '' });
    expect(r.id).toBe('123');
    expect(r.accessToken).toBe('long-tok');
  });

  it('post single image', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-create-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/p/123' })));
    const result = await provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'Single image', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], {} as any);
    expect(result).toHaveLength(1);
  });

  it('post single video as reel', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'reel-create-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'reel-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/reel/123' })));
    const result = await provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'Reel', settings: {}, media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }] }], {} as any);
    expect(result).toHaveLength(1);
  });

  it('post carousel (multiple images)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'child-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'child-2' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'container-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-carousel-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/p/carousel' })));
    const result = await provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'Carousel', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img1.jpg' }, { type: 'image', path: 'https://ex.com/img2.jpg' }] }], {} as any);
    expect(result).toHaveLength(1);
  });

  it('post story with single image', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'story-media-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'story-pub-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/stories/123' })));
    const result = await provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'Story', settings: { post_type: 'story' }, media: [{ type: 'image', path: 'https://ex.com/story.jpg' }] }], {} as any);
    expect(result).toHaveLength(1);
  });

  it('post story with multiple images (each published separately)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'story-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'story-2' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'story-pub-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/stories/1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'story-pub-2' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/stories/2' })));
    const result = await provider.post('ig-123', 'tok___userTok', [{ id: 'p1', message: 'Multi story', settings: { post_type: 'story' }, media: [{ type: 'image', path: 'https://ex.com/s1.jpg' }, { type: 'image', path: 'https://ex.com/s2.jpg' }] }], {} as any);
    expect(result).toHaveLength(1);
  });

  it('comment adds reply', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'comment-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/p/123' })));
    const result = await provider.comment('ig-123', 'post-123', undefined, 'tok___userTok', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], {} as any);
    expect(result[0].postId).toBe('comment-123');
  });

  it('analytics fetches insights', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ name: 'follower_count', values: [{ value: 100, end_time: '2024-01-02T00:00:00+0000' }] }, { name: 'reach', values: [{ value: 500, end_time: '2024-01-02T00:00:00+0000' }] }] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ name: 'likes', total_value: { value: 50 } }, { name: 'views', total_value: { value: 200 } }] })));
    const r = await provider.analytics('ig-123', 'tok___userTok', 7);
    expect(r.length).toBeGreaterThan(0);
  });

  it('postAnalytics fetches post insights', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      data: [
        { name: 'views', values: [{ value: 100 }] },
        { name: 'likes', values: [{ value: 50 }] },
        { name: 'comments', values: [{ value: 10 }] },
      ],
    }));
    const r = await provider.postAnalytics('ig-123', 'tok___userTok', 'media-123', 7);
    expect(r).toHaveLength(3);
    expect(r[0].label).toBe('Views');
  });

  it('music searches for music', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [{ id: 'music-123' }] }));
    const r = await provider.music('tok', { q: 'pop' });
    expect(r).toBeDefined();
  });

  it('pages fetches connected Instagram accounts', async () => {
    const pg = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ id: 'fb-page-1', instagram_business_account: { id: 'ig-123' }, name: 'FB Page', picture: { data: { url: 'https://ex.com/fb.jpg' } } }], paging: { next: undefined } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'ig-123', name: 'IG Acct', profile_picture_url: 'https://ex.com/ig.jpg' })));
    pg.mockResolvedValue(resp({ data: [], paging: { next: undefined } }));
    globalThis.fetch = pg;
    const r = await provider.pages('tok___userTok');
    expect(r).toHaveLength(1);
    expect(r[0].pageId).toBe('fb-page-1');
  });

  it('fetchPageInformation fetches page info', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'page-tok', name: 'FB Page', picture: { data: { url: 'https://ex.com/pic.jpg' } } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'ig-123', name: 'IG Acct', username: 'iguser', profile_picture_url: 'https://ex.com/ig.jpg' })));
    const r = await provider.fetchPageInformation('tok___userTok', { pageId: 'fb-page-1', id: 'ig-123' });
    expect(r.id).toBe('ig-123');
    expect(r.access_token).toContain('___');
  });

  it('reConnect finds and reconnects', async () => {
    const pg2 = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ id: 'fb-page-1', instagram_business_account: { id: 'ig-123' }, name: 'FB Page', picture: { data: { url: 'https://ex.com/pic.jpg' } } }], paging: { next: undefined } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [], paging: { next: undefined } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'ig-123', name: 'IG Acct', profile_picture_url: 'https://ex.com/ig.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'page-tok', name: 'FB Page', picture: { data: { url: 'https://ex.com/pic.jpg' } } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'ig-123', name: 'IG Acct', username: 'iguser', profile_picture_url: 'https://ex.com/ig.jpg' })));
    pg2.mockResolvedValue(resp({ data: [], paging: { next: undefined } }));
    globalThis.fetch = pg2;
    const r = await provider.reConnect('123', 'ig-123', 'tok___userTok');
    expect(r.id).toBe('ig-123');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. INSTAGRAM STANDALONE PROVIDER
// ─────────────────────────────────────────────────────────────
describe('instagram-standalone deep', () => {
  let provider: InstagramStandaloneProvider;

  beforeEach(() => {
    provider = new InstagramStandaloneProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 2200', () => {
    expect(provider.maxLength()).toBe(2200);
  });

  it('handleErrors delegates to instagram provider', () => {
    const r = provider.handleErrors('An unknown error occurred', 500);
    expect(r?.type).toBe('retry');
  });

  it('throws RefreshTokenError on REVOKED_ACCESS_TOKEN', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('REVOKED_ACCESS_TOKEN', 401));
    await expect(provider.post('ig-123', 'tok', [{ id: 'p1', message: 'x', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], {} as any)).rejects.toThrow(RefreshTokenError);
  });

  it('throws BadBodyError on error code 2207081', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('2207081', 400));
    await expect(provider.post('ig-123', 'tok', [{ id: 'p1', message: 'x', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], {} as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken refreshes via graph.instagram.com', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ user_id: '123', name: 'Test', username: 'testuser', profile_picture_url: 'https://ex.com/pic.jpg' })));
    const r = await provider.refreshToken('old-tok');
    expect(r.id).toBe('123');
    expect(r.accessToken).toBe('new-tok');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('instagram.com/oauth/authorize');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'short-tok', permissions: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_insights'] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'long-tok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ user_id: '123', name: 'Test', username: 'testuser', profile_picture_url: 'https://ex.com/pic.jpg' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v', refresh: '' });
    expect(r.id).toBe('123');
    expect(r.accessToken).toBe('long-tok');
  });

  it('post delegates to instagram provider', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status_code: 'FINISHED' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'pub-media-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/p/123' })));
    const r = await provider.post('ig-123', 'tok', [{ id: 'p1', message: 'Test', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], {} as any);
    expect(r).toHaveLength(1);
  });

  it('comment delegates to instagram provider', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'comment-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ permalink: 'https://ig.com/p/123' })));
    const r = await provider.comment('ig-123', 'post-123', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], {} as any);
    expect(r[0].postId).toBe('comment-123');
  });

  it('analytics delegates to instagram provider', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ name: 'follower_count', values: [{ value: 100, end_time: '2024-01-02T00:00:00+0000' }] }] })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: [{ name: 'likes', total_value: { value: 50 } }] })));
    const r = await provider.analytics('ig-123', 'tok', 7);
    expect(r.length).toBeGreaterThan(0);
  });

  it('postAnalytics delegates to instagram provider', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      data: [
        { name: 'views', values: [{ value: 100 }] },
        { name: 'likes', values: [{ value: 50 }] },
      ],
    }));
    const r = await provider.postAnalytics('ig-123', 'tok', 'media-123', 7);
    expect(r).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. YOUTUBE PROVIDER
// ─────────────────────────────────────────────────────────────
describe('youtube deep', () => {
  let provider: YoutubeProvider;

  beforeEach(() => {
    provider = new YoutubeProvider();
    // Media/thumbnail downloads now route through safeFetch, which delegates to
    // globalThis.fetch in these specs. Return a fresh ReadableStream body on
    // every call so Readable.fromWeb(mediaResponse.body) works for the
    // googleapis upload and a second fetch (thumbnail) gets an unconsumed stream.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('video-data'));
            controller.close();
          },
        }),
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('video-data').buffer),
        json: vi.fn(),
        text: vi.fn(),
        headers: new Headers(),
      })
    );
  });



  it('maxLength returns 5000', () => {
    expect(provider.maxLength()).toBe(5000);
  });

  it('checkValidity rejects without media', async () => {
    const r = await provider.checkValidity([[]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity rejects non-video media', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]]);
    expect(r).toBe(true);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('invalidTags')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidTitle')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidDescription')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidCategoryId')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidPublishAt')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidRecordingDetails')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidVideoGameRating')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidFilename')?.type).toBe('bad-body');
    expect(provider.handleErrors('defaultLanguageNotSet')?.type).toBe('bad-body');
    expect(provider.handleErrors('invalidVideoMetadata')?.type).toBe('bad-body');
    expect(provider.handleErrors('mediaBodyRequired')?.type).toBe('bad-body');
    expect(provider.handleErrors('imageFormatUnsupported')?.type).toBe('bad-body');
    expect(provider.handleErrors('imageTooTall')?.type).toBe('bad-body');
    expect(provider.handleErrors('imageTooWide')?.type).toBe('bad-body');
    expect(provider.handleErrors('rateLimitExceeded')?.type).toBe('bad-body');
    expect(provider.handleErrors('failedPrecondition')?.type).toBe('bad-body');
    expect(provider.handleErrors('uploadLimitExceeded')?.type).toBe('bad-body');
    expect(provider.handleErrors('youtubeSignupRequired')?.type).toBe('bad-body');
    expect(provider.handleErrors('youtube.thumbnail')?.type).toBe('bad-body');
    expect(provider.handleErrors('Unauthorized')?.type).toBe('refresh-token');
    expect(provider.handleErrors('UNAUTHENTICATED')?.type).toBe('refresh-token');
    expect(provider.handleErrors('invalid_grant')?.type).toBe('refresh-token');
  });

  it('refreshToken refreshes credentials', async () => {
    const r = await provider.refreshToken('rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('accounts.google.com');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.refreshToken).toBe('rtok');
    expect(r.id).toBe('123');
  });

  it('post uploads video', async () => {
    const r = await provider.post('ch-123', 'tok', [{ id: 'p1', message: 'Video desc', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { title: 'My Video', type: 'public', tags: [{ label: 'tag1' }], selfDeclaredMadeForKids: 'no' } }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('video-123');
    expect(r[0].releaseURL).toContain('youtube.com/watch');
  });

  it('post with thumbnail', async () => {
    const r = await provider.post('ch-123', 'tok', [{ id: 'p1', message: 'With thumb', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { title: 'My Video', type: 'public', thumbnail: { path: 'https://ex.com/thumb.jpg' }, selfDeclaredMadeForKids: 'yes' } }]);
    expect(r).toHaveLength(1);
  });

  it('pages fetches channels', async () => {
    const r = await provider.pages('tok');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('ch-123');
    expect(r[0].name).toBe('My Channel');
  });

  it('fetchPageInformation fetches channel', async () => {
    const r = await provider.fetchPageInformation('tok', { id: 'ch-123' });
    expect(r.id).toBe('ch-123');
    expect(r.name).toBe('My Channel');
  });

  it('reConnect finds and returns channel info', async () => {
    const r = await provider.reConnect('123', 'ch-123', 'tok');
    expect(r.id).toBe('ch-123');
  });

  it('analytics returns metrics', async () => {
    const r = await provider.analytics('ch-123', 'tok', 30);
    expect(r).toHaveLength(6);
    expect(r[0].label).toBe('Estimated Minutes Watched');
  });

  it('postAnalytics returns video stats', async () => {
    const r = await provider.postAnalytics('ch-123', 'tok', 'video-123', 30);
    expect(r).toHaveLength(4);
    expect(r.some(m => m.label === 'Views')).toBe(true);
    expect(r.some(m => m.label === 'Likes')).toBe(true);
    expect(r.some(m => m.label === 'Comments')).toBe(true);
    expect(r.some(m => m.label === 'Favorites')).toBe(true);
  });

  it('postAnalytics returns empty on error', async () => {
    mockYtVideos.list = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.postAnalytics('ch-123', 'tok', 'video-123', 30);
    expect(r).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. TIKTOK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('tiktok deep', () => {
  let provider: TiktokProvider;

  beforeEach(() => {
    provider = new TiktokProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 2000', () => {
    expect(provider.maxLength()).toBe(2000);
  });

  it('checkValidity rejects without media', async () => {
    const r = await provider.checkValidity([[]], {});
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with single video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]], {});
    expect(r).toBe(true);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('access_token_invalid', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('scope_not_authorized', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('scope_permission_missed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('rate_limit_exceeded', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('file_format_check_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('app_version_check_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('duration_check_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('frame_rate_check_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('video_pull_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('photo_pull_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('spam_risk_user_banned_from_posting', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('spam_risk_text', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('spam_risk_too_many_posts', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('spam_risk_too_many_pending_share', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('spam_risk', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('reached_active_user_cap', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('unaudited_client_can_only_post_to_private_accounts', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('url_ownership_unverified', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('privacy_level_option_mismatch', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('invalid_file_upload', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('invalid_params', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('internal', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('picture_size_check_failed', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('TikTok API error', 400)?.type).toBe('bad-body');
  });

  it('throws RefreshTokenError on access_token_invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('access_token_invalid', 400));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Test video', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { content_posting_method: 'DIRECT_POST', privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, comment: true, stitch: true, brand_content_toggle: false, brand_organic_toggle: false } }], { profile: 'user123' } as any)).rejects.toThrow(RefreshTokenError);
  });

  it('throws BadBodyError on invalid_params', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('invalid_params', 400));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Test video', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { content_posting_method: 'DIRECT_POST', privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, comment: true, stitch: true, brand_content_toggle: false, brand_organic_toggle: false } }], { profile: 'user123' } as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken refreshes token', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', refresh_token: 'new-rtok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { user: { open_id: '123', display_name: 'Test', avatar_url: 'https://ex.com/av.jpg', username: 'testuser' } } })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.refreshToken).toBe('new-rtok');
    expect(r.id).toBe('123');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('tiktok.com');
    expect(r.url).toContain('v2/auth/authorize');
    expect(r.codeVerifier).toBe(r.state);
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', refresh_token: 'rtok', scope: 'video.list,user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { user: { open_id: '123', display_name: 'Test', avatar_url: 'https://ex.com/av.jpg', username: 'testuser' } } })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
  });

  it('maxVideoLength returns duration', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { max_video_post_duration_sec: 180 } }));
    const r = await provider.maxVideoLength('tok');
    expect(r.maxDurationSeconds).toBe(180);
  });

  it('post uploads video', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { publish_id: 'pub-123' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['vid-123'] } })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Test video', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { content_posting_method: 'DIRECT_POST', privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, comment: true, stitch: true, brand_content_toggle: false, brand_organic_toggle: false } }], { profile: 'user123' } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('vid-123');
  });

  it('post sends to inbox when status is SEND_TO_USER_INBOX', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { publish_id: 'pub-456' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { status: 'SEND_TO_USER_INBOX' } })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Test', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { content_posting_method: 'DIRECT_POST', privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, comment: true, stitch: true, brand_content_toggle: false, brand_organic_toggle: false } }], { profile: 'user123' } as any);
    expect(r[0].postId).toBe('missing');
  });

  it('post uses UPLOAD method for video', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { publish_id: 'pub-789' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['vid-789'] } })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Test', media: [{ path: 'https://ex.com/vid.mp4' }], settings: { content_posting_method: 'UPLOAD', privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, comment: true, stitch: true, brand_content_toggle: false, brand_organic_toggle: false } }], { profile: 'user123' } as any);
    expect(r[0].postId).toBe('vid-789');
  });

  it('post uploads photo with DIRECT_POST', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { publish_id: 'pub-photo' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['photo-123'] } })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Photo post', media: [{ path: 'https://ex.com/img.jpg' }], settings: { content_posting_method: 'DIRECT_POST', privacy_level: 'PUBLIC_TO_EVERYONE', title: 'Photo title', brand_content_toggle: false, brand_organic_toggle: false, autoAddMusic: 'yes' } }], { profile: 'user123' } as any);
    expect(r[0].postId).toBe('photo-123');
  });

  it('post uploads multiple photos with MEDIA_UPLOAD', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { publish_id: 'pub-multi' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['multi-123'] } })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Multi photo', media: [{ path: 'https://ex.com/img1.jpg' }, { path: 'https://ex.com/img2.jpg' }], settings: { content_posting_method: 'DIRECT_POST', privacy_level: 'PUBLIC_TO_EVERYONE', title: 'Multi', brand_content_toggle: false, brand_organic_toggle: false } }], { profile: 'user123' } as any);
    expect(r[0].postId).toBe('multi-123');
  });

  it('analytics fetches user stats and video metrics', async () => {
    const userStatsResponse = { data: { user: { follower_count: 100, following_count: 50, likes_count: 500, video_count: 20 } } };
    const videoListResponse = { data: { videos: [{ id: 'v1' }, { id: 'v2' }] } };
    const videoQueryResponse = { data: { videos: [{ id: 'v1', like_count: 10, comment_count: 5, share_count: 2, view_count: 100 }, { id: 'v2', like_count: 20, comment_count: 3, share_count: 1, view_count: 200 }] } };
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp(userStatsResponse)))
      .mockImplementationOnce(() => Promise.resolve(resp(videoListResponse)))
      .mockImplementationOnce(() => Promise.resolve(resp(videoQueryResponse)));
    const r = await provider.analytics('user123', 'tok', 7);
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r.some(m => m.label === 'Followers')).toBe(true);
    expect(r.some(m => m.label === 'Views')).toBe(true);
  });

  it('analytics returns user stats without video metrics when no videos', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { user: { follower_count: 100, following_count: 50, likes_count: 500, video_count: 20 } } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { videos: [] } })));
    const r = await provider.analytics('user123', 'tok', 7);
    expect(r).toHaveLength(4);
  });

  it('analytics returns user stats without video metrics when videos is null', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { user: { follower_count: 100 } } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: {} })));
    const r = await provider.analytics('user123', 'tok', 7);
    expect(r).toHaveLength(1);
  });

  it('postAnalytics fetches video stats', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { videos: [{ id: 'v1', like_count: 10, comment_count: 5, share_count: 2, view_count: 100 }] } })));
    const r = await provider.postAnalytics('user123', 'tok', 'v1', 7);
    expect(r).toHaveLength(4);
    expect(r.some(m => m.label === 'Views')).toBe(true);
  });

  it('postAnalytics handles publish URL (v_pub_url)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { publicaly_available_post_id: ['real-vid'] } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { videos: [{ id: 'real-vid', like_count: 10, comment_count: 5, share_count: 2, view_count: 100 }] } })));
    const r = await provider.postAnalytics('user123', 'tok', 'v_pub_url_pub-123', 7);
    expect(r).toHaveLength(4);
  });

  it('postAnalytics returns empty when publish URL has no available id', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: {} })));
    const r = await provider.postAnalytics('user123', 'tok', 'v_pub_url_pub-123', 7);
    expect(r).toEqual([]);
  });

  it('missing fetches video list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { videos: [{ id: 'v1', cover_image_url: 'https://ex.com/cover.jpg' }] } }));
    const r = await provider.missing('user123', 'tok');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('v1');
  });

  it('missing returns empty when no videos', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { videos: [] } }));
    const r = await provider.missing('user123', 'tok');
    expect(r).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. LINKEDIN PROVIDER
// ─────────────────────────────────────────────────────────────
describe('linkedin deep', () => {
  let provider: LinkedinProvider;

  beforeEach(() => {
    provider = new LinkedinProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 3000', () => {
    expect(provider.maxLength()).toBe(3000);
  });

  it('checkValidity rejects carousel with video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]], { post_as_images_carousel: true });
    expect(r).not.toBe(true);
  });

  it('checkValidity rejects multiple video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }, { path: 'https://ex.com/img.jpg' }]], {});
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with single image', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]], {});
    expect(r).toBe(true);
  });

  it('handleErrors returns retry for specific errors', () => {
    expect(provider.handleErrors('Unable to obtain activity')?.type).toBe('retry');
    expect(provider.handleErrors('resource is forbidden')?.type).toBe('retry');
    expect(provider.handleErrors('Service Unavailable')?.type).toBe('retry');
  });

  it('refreshToken refreshes via oauth', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', refresh_token: 'new-rtok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ vanityName: 'testuser' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'Test', sub: '123', picture: 'https://ex.com/pic.jpg' })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('linkedin.com/oauth/v2/authorization');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', expires_in: 7200, refresh_token: 'rtok', scope: 'openid profile w_member_social r_basicprofile rw_organization_admin w_organization_social r_organization_social' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'Test', sub: '123', picture: 'https://ex.com/pic.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ vanityName: 'testuser' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
  });

  it('company finds LinkedIn company by URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ elements: [{ localizedName: 'Acme', id: 'acme-123' }] }));
    const r = await provider.company('tok', { url: 'https://www.linkedin.com/company/acme' });
    expect(r.options.value).toContain('urn:li:organization:acme-123');
  });

  it('post without media', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(respCreated()));
    const r = await provider.post('person-123', 'tok', [{ id: 'p1', message: 'Test post', media: [], settings: {} }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('urn:li:post:abc');
  });

  it('post with image (personal type - timer wait, no polling)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ value: { uploadUrl: 'https://upload.ex.com', image: 'urn:li:image:img-123' } })))
      .mockImplementationOnce(() => Promise.resolve(respEtag()))
      .mockImplementationOnce(() => Promise.resolve(respCreated()));
    const r = await provider.post('person-123', 'tok', [{ id: 'p1', message: 'With image', media: [{ type: 'image', path: 'https://ex.com/img.jpg' }], settings: {} }], {} as any);
    expect(r).toHaveLength(1);
  });

  it('post with video (personal type - chunked upload + finalize + polling)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ value: { uploadUrl: 'https://upload.ex.com', video: 'urn:li:video:vid-123', uploadInstructions: undefined } })))
      .mockImplementationOnce(() => Promise.resolve(respEtag()))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'AVAILABLE' })))
      .mockImplementationOnce(() => Promise.resolve(respCreated()));
    const r = await provider.post('person-123', 'tok', [{ id: 'p1', message: 'With video', media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }], settings: {} }], {} as any);
    expect(r).toHaveLength(1);
  });

  it('comment replies to post', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ object: 'urn:li:post:comment-123' })));
    const r = await provider.comment('person-123', 'urn:li:post:abc', undefined, 'tok', [{ id: 'c1', message: 'Nice!', media: [], settings: {} }], {} as any);
    expect(r[0].postId).toBe('urn:li:post:comment-123');
  });

  it('mention finds organizations', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      elements: [{ id: '123', localizedName: 'Acme Corp', logoV2: { 'original~': { elements: [{ identifiers: [{ identifier: 'https://ex.com/logo.png' }] }] } } }],
    }));
    const r = await provider.mention('tok', { query: 'acme' });
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe('Acme Corp');
  });

  it('mentionFormat formats correctly', () => {
    expect(provider.mentionFormat('123', '@Acme')).toBe('@[Acme](urn:li:organization:123)');
  });
});

// ─────────────────────────────────────────────────────────────
// 8. LINKEDIN PAGE PROVIDER
// ─────────────────────────────────────────────────────────────
describe('linkedin-page deep', () => {
  let provider: LinkedinPageProvider;

  beforeEach(() => {
    provider = new LinkedinPageProvider();
    globalThis.fetch = vi.fn();
  });



  it('refreshToken refreshes via oauth', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', expires_in: 7200, refresh_token: 'new-rtok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ vanityName: 'testuser' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'Test', sub: '123', picture: 'https://ex.com/pic.jpg' })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('linkedin.com');
    expect(r.url).toContain('linkedin-page');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', expires_in: 7200, refresh_token: 'rtok', scope: 'openid profile w_member_social r_basicprofile rw_organization_admin w_organization_social r_organization_social' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'Test', sub: '123', picture: 'https://ex.com/pic.jpg' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ vanityName: 'testuser' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
  });

  it('post delegates to super with company type', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(respCreated()));
    const r = await provider.post('org-123', 'tok', [{ id: 'p1', message: 'Org post', media: [], settings: {} }], {} as any);
    expect(r).toHaveLength(1);
  });

  it('comment delegates to super with company type', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ object: 'urn:li:post:comment-456' })));
    const r = await provider.comment('org-123', 'urn:li:post:abc', undefined, 'tok', [{ id: 'c1', message: 'Nice!', media: [], settings: {} }], {} as any);
    expect(r[0].postId).toBe('urn:li:post:comment-456');
  });

  it('companies fetches organization list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      elements: [{ organizationalTarget: 'urn:li:organization:org-123', 'organizationalTarget~': { localizedName: 'Acme', vanityName: 'acme', logoV2: { 'original~': { elements: [{ identifiers: [{ identifier: 'https://ex.com/logo.png' }] }] } } } }],
    }));
    const r = await provider.companies('tok');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('org-123');
  });

  it('fetchPageInformation fetches org details', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      id: 'org-123', localizedName: 'Acme Corp', vanityName: 'acme',
      logoV2: { 'original~': { elements: [{ identifiers: [{ identifier: 'https://ex.com/logo.png' }] }] } },
    }));
    const r = await provider.fetchPageInformation('tok', { page: 'org-123' });
    expect(r.id).toBe('org-123');
    expect(r.name).toBe('Acme Corp');
  });

  it('reConnect fetches page information', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      id: 'org-123', localizedName: 'Acme Corp', vanityName: 'acme',
      logoV2: { 'original~': { elements: [{ identifiers: [{ identifier: 'https://ex.com/logo.png' }] }] } },
    }));
    const r = await provider.reConnect('123', 'org-123', 'tok');
    expect(r.id).toBe('org-123');
  });

  it('analytics fetches page stats', async () => {
    const pageStatsResp = resp({
      elements: [{ totalPageStatistics: { views: { allPageViews: { pageViews: 100 } } }, timeRange: { start: 1700000000000 } }],
    });
    const followerStatsResp = resp({
      elements: [{ followerGains: { organicFollowerGain: 5, paidFollowerGain: 2 }, timeRange: { start: 1700000000000 } }],
    });
    const shareStatsResp = resp({
      elements: [{ totalShareStatistics: { clickCount: 10, shareCount: 3, engagement: 15, commentCount: 4 }, timeRange: { start: 1700000000000 } }],
    });
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(pageStatsResp))
      .mockImplementationOnce(() => Promise.resolve(followerStatsResp))
      .mockImplementationOnce(() => Promise.resolve(shareStatsResp));
    const r = await provider.analytics('org-123', 'tok', 7);
    expect(r.length).toBeGreaterThan(0);
    const labels = r.map((x: any) => x.label);
    expect(labels).toContain('Page Views');
  });

  it('postAnalytics fetches share stats', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({
        elements: [{ totalShareStatistics: { impressionCount: 500, uniqueImpressionsCount: 300, clickCount: 50, likeCount: 25, commentCount: 10, shareCount: 5, engagement: 90 }, timeRange: { start: 1700000000000 } }],
      })))
      .mockImplementationOnce(() => Promise.resolve(resp({
        likesSummary: { totalLikes: 25, likedByCurrentUser: false },
        commentsSummary: { totalFirstLevelComments: 10, commentsState: 'ALLOWED' },
      })));
    const r = await provider.postAnalytics('org-123', 'tok', 'urn:li:post:abc', 7);
    expect(r.length).toBeGreaterThan(0);
  });

  it('autoRepostPost reposts when likes threshold met', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ likesSummary: { totalLikes: 100 } })))
      .mockImplementationOnce(() => Promise.resolve(respCreated()));
    const r = await provider.autoRepostPost({ token: 'tok', internalId: 'org-123' } as any, 'urn:li:post:abc', { likesAmount: '50' });
    expect(r).toBe(true);
  });

  it('autoRepostPost returns false when likes below threshold', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ likesSummary: { totalLikes: 10 } })));
    const r = await provider.autoRepostPost({ token: 'tok', internalId: 'org-123' } as any, 'urn:li:post:abc', { likesAmount: '50' });
    expect(r).toBe(false);
  });

  it('autoPlugPost comments when likes threshold met', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ likesSummary: { totalLikes: 100 } })))
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const r = await provider.autoPlugPost({ token: 'tok', internalId: 'org-123' } as any, 'urn:li:post:abc', { likesAmount: '50', post: 'Great content!' });
    expect(r).toBe(true);
  });

  it('autoPlugPost returns false when likes below threshold', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ likesSummary: { totalLikes: 10 } })));
    const r = await provider.autoPlugPost({ token: 'tok', internalId: 'org-123' } as any, 'urn:li:post:abc', { likesAmount: '50', post: 'Great!' });
    expect(r).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. REDDIT PROVIDER
// ─────────────────────────────────────────────────────────────
describe('reddit deep', () => {
  let provider: RedditProvider;

  beforeEach(() => {
    provider = new RedditProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 10000', () => {
    expect(provider.maxLength()).toBe(10000);
  });

  it('refreshToken fetches access token and user info', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'testuser', id: '123', icon_img: 'https://ex.com/icon.jpg?123' })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
    expect(r.username).toBe('testuser');
    expect(r.picture).toBe('https://ex.com/icon.jpg');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('reddit.com/api/v1/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', refresh_token: 'rtok', expires_in: 7200, scope: 'read identity submit flair' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ name: 'testuser', id: '123', icon_img: 'https://ex.com/icon.jpg' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
  });

  it('post text to subreddit', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ json: { data: { id: 'post-123', name: 't3_post-123', url: 'https://reddit.com/r/test/comments/post-123/title/' } } }));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Test post', media: [], settings: { subreddit: [{ value: { type: 'self', title: 'Post Title', subreddit: '/r/test' } }] } }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('post-123');
  });

  it('post with media and image upload', async () => {
    const mediaResp = {
      status: 200,
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('image-bytes')),
      blob: vi.fn().mockResolvedValue(new Blob(['image-bytes'])),
    };
    const xmlResp = { status: 200, ok: true, json: vi.fn().mockResolvedValue({}), text: vi.fn().mockResolvedValue('<Location>https://reddit.com/media/uploaded.jpg</Location>'), headers: new Map() };
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ args: { action: '//s3.amazonaws.com/bucket', fields: [{ name: 'key', value: 'val' }] } })))
      .mockImplementationOnce(() => Promise.resolve(mediaResp))
      .mockImplementationOnce(() => Promise.resolve(xmlResp))
      .mockImplementationOnce(() => Promise.resolve(resp({ json: { data: { id: 'post-456', name: 't3_post-456', url: 'https://reddit.com/r/test/...' } } })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Media post', media: [{ type: 'image', path: 'https://ex.com/img.jpg' }], settings: { subreddit: [{ value: { type: 'media', title: 'Media', subreddit: '/r/test' } }] } }]);
    expect(r).toHaveLength(1);
  });

  it('comment adds reply', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ json: { data: { things: [{ data: { id: 'comment-123', permalink: '/r/test/comments/abc/def/comment-123' } }] } } }));
    const r = await provider.comment('user123', 't3_post-123', undefined, 'tok', [{ id: 'c1', message: 'Nice post!', media: [], settings: {} }], {} as any);
    expect(r[0].postId).toBe('comment-123');
    expect(r[0].releaseURL).toContain('reddit.com');
  });

  it('comment handles non t3_ prefix', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ json: { data: { things: [{ data: { id: 'comment-456', permalink: '/r/test/comments/abc/def/comment-456' } }] } } }));
    const r = await provider.comment('user123', 'post-123', undefined, 'tok', [{ id: 'c2', message: 'Reply', media: [], settings: {} }], {} as any);
    expect(r[0].postId).toBe('comment-456');
  });

  it('subreddits searches subreddits', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { children: [{ data: { title: 'Test Sub', url: '/r/test', id: 'sub-123', subreddit_type: 'public', submission_type: 'any' } }] } }));
    const r = await provider.subreddits('tok', { word: 'test' });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('/r/test');
  });

  it('restrictions gets subreddit restrictions', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { submission_type: 'any', allow_images: true } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ is_flair_required: true })))
      .mockImplementationOnce(() => Promise.resolve(resp([{ id: 'flair-1', text: 'Discussion' }])));
    const r = await provider.restrictions('tok', { subreddit: '/r/test' });
    expect(r.allow).toContain('self');
    expect(r.allow).toContain('link');
    expect(r.allow).toContain('media');
    expect(r.is_flair_required).toBe(true);
    expect(r.flairs).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. PINTEREST PROVIDER
// ─────────────────────────────────────────────────────────────
describe('pinterest deep', () => {
  let provider: PinterestProvider;

  beforeEach(() => {
    provider = new PinterestProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 500', () => {
    expect(provider.maxLength()).toBe(500);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('constraint: maxItems=5', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('Unable to reach the URL', 400)?.type).toBe('retry');
    expect(provider.handleErrors(`does not match '^\\d+$'`, 400)).toBeUndefined();
    expect(provider.handleErrors('Board not found', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('cover_image_url or cover_image_content_type', 400)?.type).toBe('bad-body');
  });

  it('throws BadBodyError on Board not found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('Board not found', 400));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Test pin', media: [{ type: 'image', path: 'https://ex.com/img.jpg' }], settings: { board: 'board-123' } }])).rejects.toThrow(BadBodyError);
  });

  it('refreshToken fetches new token and user info', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok', expires_in: 7200 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', profile_image: 'https://ex.com/pic.jpg', username: 'testuser' })));
    const r = await provider.refreshToken('old-rtok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('pinterest.com/oauth');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'tok', refresh_token: 'rtok', expires_in: 7200, scope: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', profile_image: 'https://ex.com/pic.jpg', username: 'testuser' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v', refresh: '' });
    expect(r.accessToken).toBe('tok');
    expect(r.id).toBe('123');
  });

  it('boards fetches boards list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ items: [{ name: 'My Board', id: 'board-123' }] }));
    const r = await provider.boards('tok');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('board-123');
  });

  it('post single image', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'pin-123' }));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Test pin', media: [{ type: 'image', path: 'https://ex.com/img.jpg' }], settings: { board: 'board-123' } }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('pin-123');
  });

  it('post with video', async () => {
    // Sequence through the shared fetch mock: (1) this.fetch registers the media,
    // (2) safeFetch downloads the source video (reads .blob()), (3) safeFetch PUTs
    // to the presigned upload_url, (4) this.fetch polls media status, (5) this.fetch
    // creates the pin. The download+upload legs used to be bare axios (mocked
    // separately) — they now route through safeFetch, so two extra mocks are needed.
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ media_id: 'media-123', upload_url: 'https://upload.ex.com', upload_parameters: { key: 'val' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'succeeded' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'pin-vid-123' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Video pin', media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }, { type: 'image', path: 'https://ex.com/cover.jpg' }], settings: { board: 'board-123', title: 'My Pin', link: 'https://ex.com', dominant_color: '#ff0000' } }]);
    expect(r[0].postId).toBe('pin-vid-123');
  });

  it('post multiple images', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'pin-multi-123' }));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Multi pin', media: [{ type: 'image', path: 'https://ex.com/img1.jpg' }, { type: 'image', path: 'https://ex.com/img2.jpg' }], settings: { board: 'board-123' } }]);
    expect(r[0].postId).toBe('pin-multi-123');
  });

  it('analytics fetches daily metrics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      all: { daily_metrics: [{ date: '2024-01-01', metrics: { PIN_CLICK_RATE: 0.5, IMPRESSION: 100, PIN_CLICK: 10, ENGAGEMENT: 20, SAVE: 5 } }] },
    }));
    const r = await provider.analytics('user123', 'tok', 7);
    expect(r).toHaveLength(5);
    expect(r[0].label).toBe('Pin click rate');
  });

  it('analytics returns empty metrics when no data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      all: { daily_metrics: [{ date: '2024-01-01', metrics: {} }] },
    }));
    const r = await provider.analytics('user123', 'tok', 7);
    expect(r).toHaveLength(5);
    expect(r[0].data).toHaveLength(0);
  });

  it('postAnalytics fetches lifetime metrics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      all: { lifetime_metrics: { IMPRESSION: 1000, PIN_CLICK: 50, OUTBOUND_CLICK: 10, SAVE: 25 } },
    }));
    const r = await provider.postAnalytics('user123', 'tok', 'pin-123', 7);
    expect(r).toHaveLength(4);
    expect(r[0].label).toBe('Impressions');
  });

  it('postAnalytics returns empty when no data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
    const r = await provider.postAnalytics('user123', 'tok', 'pin-123', 7);
    expect(r).toEqual([]);
  });

  it('postAnalytics returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.postAnalytics('user123', 'tok', 'pin-123', 7);
    expect(r).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 11. THREADS PROVIDER
// ─────────────────────────────────────────────────────────────
describe('threads deep', () => {
  let provider: ThreadsProvider;

  beforeEach(() => {
    provider = new ThreadsProvider();
    globalThis.fetch = vi.fn();
  });



  it('maxLength returns 500', () => {
    expect(provider.maxLength()).toBe(500);
  });

  it('handleErrors returns correct types', () => {
    expect(provider.handleErrors('Error validating access token', 400)?.type).toBe('refresh-token');
    expect(provider.handleErrors('2207051', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('The media could not be fetched from this URI', 400)?.type).toBe('bad-body');
    expect(provider.handleErrors('text must be at most 500 characters', 400)?.type).toBe('bad-body');
  });

  it('throws RefreshTokenError on access token validation error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('Error validating access token', 400));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Threads!', settings: {}, media: [] }])).rejects.toThrow(RefreshTokenError);
  });

  it('throws BadBodyError on error code 2207051', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('2207051', 400));
    await expect(provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Threads!', settings: {}, media: [] }])).rejects.toThrow(BadBodyError);
  });

  it('refreshToken fetches new long-lived token', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'new-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', username: 'testuser', name: 'testuser', picture: 'https://ex.com/pic.jpg', threads_profile_picture_url: 'https://ex.com/pic.jpg' })));
    const r = await provider.refreshToken('old-tok');
    expect(r.accessToken).toBe('new-tok');
    expect(r.id).toBe('123');
  });

  it('generateAuthUrl constructs URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r.url).toContain('threads.net/oauth/authorize');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
  });

  it('authenticate exchanges code for tokens', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'short-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ access_token: 'long-tok' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: '123', username: 'testuser', name: 'testuser', picture: 'https://ex.com/pic.jpg', threads_profile_picture_url: 'https://ex.com/pic.jpg' })));
    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect(r.accessToken).toBe('long-tok');
    expect(r.id).toBe('123');
  });

  it('post text-only thread', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-123', permalink: 'https://threads.net/p/123' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Hello Threads!', settings: {}, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('thread-123');
  });

  it('post with single media', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'media-content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'media-content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-456' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-456', permalink: 'https://threads.net/p/456' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'With image', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }]);
    expect(r[0].postId).toBe('thread-456');
  });

  it('post with video', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'vid-content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'vid-content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-789' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-789', permalink: 'https://threads.net/p/789' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Video', settings: {}, media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }] }]);
    expect(r[0].postId).toBe('thread-789');
  });

  it('post with carousel (multiple images)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'carousel-item-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'carousel-item-2' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'carousel-item-1' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'carousel-item-2' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'carousel-container-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'carousel-container-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-carousel-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'thread-carousel-123', permalink: 'https://threads.net/p/carousel' })));
    const r = await provider.post('user123', 'tok', [{ id: 'p1', message: 'Carousel', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img1.jpg' }, { type: 'image', path: 'https://ex.com/img2.jpg' }] }]);
    expect(r[0].postId).toBe('thread-carousel-123');
  });

  it('post returns empty when no post details', async () => {
    const r = await provider.post('user123', 'tok', []);
    expect(r).toEqual([]);
  });

  it('comment text-only reply', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'reply-content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'reply-content-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'reply-thread-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'reply-thread-123', permalink: 'https://threads.net/p/reply' })));
    const r = await provider.comment('user123', 'thread-123', undefined, 'tok', [{ id: 'c1', message: 'Great!', settings: {}, media: [] }], {} as any);
    expect(r[0].postId).toBe('reply-thread-123');
  });

  it('comment with lastCommentId', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'nested-reply-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ status: 'FINISHED', id: 'nested-reply-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'nested-thread-123' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'nested-thread-123', permalink: 'https://threads.net/p/nested' })));
    const r = await provider.comment('user123', 'thread-123', 'existing-comment', 'tok', [{ id: 'c2', message: 'Nested reply', settings: {}, media: [] }], {} as any);
    expect(r[0].postId).toBe('nested-thread-123');
  });

  it('comment returns empty when no post details', async () => {
    const r = await provider.comment('user123', 'thread-123', undefined, 'tok', [], {} as any);
    expect(r).toEqual([]);
  });

  it('analytics fetches thread insights', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      data: [
        { name: 'views', values: [{ value: 100, end_time: '2024-01-02T00:00:00+0000' }] },
        { name: 'likes', total_value: { value: 50 } },
        { name: 'replies', values: [{ value: 10, end_time: '2024-01-02T00:00:00+0000' }] },
      ],
    }));
    const r = await provider.analytics('user123', 'tok', 7);
    expect(r).toHaveLength(3);
    expect(r[0].label).toBe('Views');
  });

  it('postAnalytics fetches post insights', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({
      data: [
        { name: 'views', values: [{ value: 200 }] },
        { name: 'likes', values: [{ value: 50 }] },
        { name: 'replies', values: [{ value: 10 }] },
        { name: 'reposts', values: [{ value: 5 }] },
        { name: 'quotes', values: [{ value: 2 }] },
      ],
    }));
    const r = await provider.postAnalytics('user123', 'tok', 'thread-123', 7);
    expect(r).toHaveLength(5);
    expect(r[0].label).toBe('Views');
  });

  it('postAnalytics returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const r = await provider.postAnalytics('user123', 'tok', 'thread-123', 7);
    expect(r).toEqual([]);
  });
});
