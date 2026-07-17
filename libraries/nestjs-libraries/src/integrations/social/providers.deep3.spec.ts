import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventEmitter from 'events';

vi.mock('sharp', () => ({ default: vi.fn(function() { return ({
  metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  toFormat: vi.fn(() => ({
    resize: vi.fn(() => ({ toBuffer: vi.fn().mockResolvedValue(Buffer.from('image')) })),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('image')),
  })),
  resize: vi.fn(() => ({ gif: vi.fn(() => ({ toBuffer: vi.fn().mockResolvedValue(Buffer.from('gif')) })) })),
  gif: vi.fn(() => ({ toBuffer: vi.fn().mockResolvedValue(Buffer.from('gif')) })),
}); }) }));
vi.mock('@gitroom/helpers/utils/timer', () => ({ timer: vi.fn() }));
vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: vi.fn().mockResolvedValue(Buffer.from('data')) }));
// safeFetch's SSRF pre-validation does real DNS; delegate to the mocked global
// fetch so provider-logic specs stay deterministic (SSRF blocking is covered by
// social.abstract.spec.ts). Matches that spec's safe.fetch mock.
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({ safeFetch: vi.fn((url: string, options?: RequestInit) => (globalThis.fetch as any)(url, options)) }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(), ProviderConfiguration: class {}, Integration: class {} }));
vi.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { fixedEncryption: vi.fn((s: string) => s), fixedDecryption: vi.fn((s: string) => s), signJWT: vi.fn(() => 'signed-jwt'), verifyJWT: vi.fn(() => ({ password: 'deadbeef' })) } }));
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
  getOrgCredential: (_orgId: string, identifier: string, key: string) => {
    if (identifier === 'farcaster' && key === 'clientSecret') return 'neynar-secret-key';
    if (identifier === 'farcaster' && key === 'clientId') return 'neynar-client-id';
    return 'mock-value';
  },
  setCredentials: vi.fn(),
  getCredential: vi.fn(() => undefined),
  clearCredentials: vi.fn(),
  replaceCredentialsMap: vi.fn(),
}));
vi.mock('ws', () => {
  return { default: class MockWebSocket extends EventEmitter { close = vi.fn(); } };
});

const mockAxios = vi.hoisted(() => {
  const fn = vi.fn().mockResolvedValue({ data: Buffer.from('image-data'), status: 200 });
  fn.get = vi.fn().mockResolvedValue({ data: Buffer.from('image-data'), status: 200 });
  fn.post = vi.fn().mockResolvedValue({ status: 200, data: { success: true, post: { id: 'molt-post-1' }, comment: { id: 'molt-comment-1' }, agent: { id: 'agent-123', name: 'TestAgent', display_name: 'Test Agent' } } });
  return fn;
});
vi.mock('axios', () => ({ default: mockAxios }));
vi.mock('form-data', () => ({ default: class FormData { append = vi.fn(); } }));

const mockBskyAgent = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue({ data: { accessJwt: 'access-jwt', refreshJwt: 'refresh-jwt', handle: 'testhandle', did: 'did:plc:123' } }),
  getProfile: vi.fn().mockResolvedValue({ data: { displayName: 'Test User', avatar: 'https://ex.com/avatar.jpg', handle: 'testhandle' } }),
  uploadBlob: vi.fn().mockResolvedValue({ data: { blob: { ref: { $link: 'ref-123' }, mimeType: 'image/jpeg', size: 12345 } } }),
  post: vi.fn().mockResolvedValue({ cid: 'cid-123', uri: 'at://did:plc:123/app.bsky.feed.post/post-123', commit: {} }),
  getPostThread: vi.fn().mockResolvedValue({
    data: {
      thread: {
        post: {
          uri: 'at://did:plc:123/app.bsky.feed.post/post-123',
          cid: 'parent-cid',
          record: { reply: { root: { uri: 'at://root/post-root', cid: 'root-cid' } } },
          likeCount: 50,
          replyCount: 1,
          viewer: { like: 'at://like/uri' },
          author: { did: 'did:plc:author', displayName: 'Author', handle: 'author', avatar: 'https://ex.com/author.jpg' },
        },
        replies: [
          {
            post: {
              uri: 'at://did:plc:123/app.bsky.feed.post/reply-1',
              cid: 'cid-reply-1',
              record: { text: 'Great post!', reply: { parent: { uri: 'at://did:plc:123/app.bsky.feed.post/post-123' } }, createdAt: '2024-01-01T00:00:00.000Z' },
              likeCount: 3,
              replyCount: 0,
              viewer: { like: undefined },
              author: { did: 'did:plc:reply-author', displayName: 'Reply Author', handle: 'replyauthor', avatar: 'https://ex.com/reply.jpg' },
              indexedAt: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      },
    },
  }),
  searchActors: vi.fn().mockResolvedValue({ data: { actors: [{ displayName: 'Test Actor', handle: 'testactor', avatar: 'https://ex.com/avatar.jpg' }] } }),
  repost: vi.fn().mockResolvedValue({}),
  like: vi.fn().mockResolvedValue({}),
  deleteLike: vi.fn().mockResolvedValue({}),
  app: {
    bsky: {
      video: { getJobStatus: vi.fn().mockResolvedValue({ data: { jobStatus: { state: 'JOB_STATE_COMPLETED', blob: { ref: { $link: 'vid-ref' } } } } }) },
      feed: { getLikes: vi.fn().mockResolvedValue({ data: { likes: [{ actor: { did: 'did:plc:123' }, uri: 'at://like/uri' }] } }) },
    },
  },
  com: { atproto: { server: { getServiceAuth: vi.fn().mockResolvedValue({ data: { token: 'service-token' } }) } } },
  dispatchUrl: new URL('https://bsky.social'),
  session: { did: 'did:plc:123' },
}));
vi.mock('@atproto/api', () => ({
  BskyAgent: vi.fn(function() { return mockBskyAgent; }),
  AtpAgent: vi.fn(function() { return mockBskyAgent; }),
  RichText: vi.fn(function() {
    return {
      detectFacets: vi.fn().mockResolvedValue(undefined),
      text: 'Hello world',
      facets: [],
    };
  }),
  AppBskyEmbedVideo: {},
  AppBskyVideoDefs: {},
  BlobRef: class {},
}));

const mockNostrGetPublicKey = vi.hoisted(() => vi.fn(() => 'pubkey-123'));
const mockNostrRelaySubscribe = vi.hoisted(() => vi.fn((_filters: any, options: any) => {
  options.onevent({ id: 'event-id-123' });
}));
vi.mock('nostr-tools', () => ({
  getPublicKey: mockNostrGetPublicKey,
  Relay: {
    connect: vi.fn().mockResolvedValue({
      subscribe: mockNostrRelaySubscribe,
      publish: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }),
  },
  finalizeEvent: vi.fn((event: any) => ({ ...event, id: 'event-id-123', sig: 'sig-123' })),
  SimplePool: vi.fn(function() {
    return {
      get: vi.fn().mockResolvedValue({ kind: 0, content: JSON.stringify({ name: 'Test User', display_name: 'Test User', picture: 'https://ex.com/pic.jpg' }), id: 'evt-1' }),
      close: vi.fn(),
    };
  }),
}));

vi.mock('@neynar/nodejs-sdk', () => ({
  NeynarAPIClient: vi.fn(function() { return ({
    publishCast: vi.fn().mockResolvedValue({ cast: { hash: 'cast-hash-123', author: { username: 'testuser' } } }),
    searchChannels: vi.fn().mockResolvedValue({ channels: [{ id: 'ch-1', name: 'Test Channel', object: 'channel' }] }),
  }); }),
}));

const mockTelegramBot = vi.hoisted(() => ({
  getChat: vi.fn().mockResolvedValue({ id: 12345, title: 'Test Chat', username: 'testchat', photo: { big_file_id: 'file-123' } }),
  getFileLink: vi.fn().mockResolvedValue('https://ex.com/photo.jpg'),
  sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
  sendVideo: vi.fn().mockResolvedValue({ message_id: 101 }),
  sendPhoto: vi.fn().mockResolvedValue({ message_id: 102 }),
  sendDocument: vi.fn().mockResolvedValue({ message_id: 103 }),
  sendMediaGroup: vi.fn().mockResolvedValue([{ message_id: 104 }]),
  getUpdates: vi.fn().mockResolvedValue([]),
  getMe: vi.fn().mockResolvedValue({ id: 999 }),
  getChatMember: vi.fn().mockResolvedValue({ status: 'administrator', can_delete_messages: true }),
  deleteMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn(function() { return mockTelegramBot; }),
}));

vi.mock('json-to-graphql-query', () => ({
  jsonToGraphQLQuery: vi.fn(() => 'mutation { publishPost(input: {}) { post { id url } } }'),
}));

vi.mock('mime', () => ({ default: { getType: vi.fn((url: string) => url.endsWith('.mp4') ? 'video/mp4' : url.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream') } }));

vi.mock('striptags', () => ({ default: vi.fn((s: string, allowed?: string[]) => s) }));

vi.mock('slugify', () => ({ default: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')) }));

process.env.FRONTEND_URL = 'http://localhost:5000';
process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:5000';
process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = '/uploads';

import { RefreshTokenError, BadBodyError } from '@gitroom/nestjs-libraries/inngest/errors';
import { BlueskyProvider } from './bluesky.provider';
import { LemmyProvider } from './lemmy.provider';
import { NostrProvider } from './nostr.provider';
import { FarcasterProvider } from './farcaster.provider';
import { TelegramProvider } from './telegram.provider';
import { MediumProvider } from './medium.provider';
import { DevToProvider } from './dev.to.provider';
import { HashnodeProvider } from './hashnode.provider';
import { WordpressProvider } from './wordpress.provider';
import { ListmonkProvider } from './listmonk.provider';
import { SkoolProvider } from './skool.provider';
import { MoltbookProvider } from './moltbook.provider';

function resp(data: any) {
  return {
    status: 200, ok: true,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Map(),
  };
}

function respCreated() {
  return {
    status: 201, ok: true,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue('{}'),
    headers: new Map(),
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
// 1. BLUESKY PROVIDER
// ─────────────────────────────────────────────────────────────
describe('bluesky deep', () => {
  let provider: BlueskyProvider;

  beforeEach(() => {
    provider = new BlueskyProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 300', () => {
    expect(provider.maxLength()).toBe(300);
  });

  it('checkValidity rejects post with video and other media', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }, { path: 'https://ex.com/img.jpg' }]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity rejects more than 4 images', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/1.jpg' }, { path: 'https://ex.com/2.jpg' }, { path: 'https://ex.com/3.jpg' }, { path: 'https://ex.com/4.jpg' }, { path: 'https://ex.com/5.jpg' }]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with valid media', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]]);
    expect(r).toBe(true);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
    expect(r.id).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate logs in and fetches profile', async () => {
    const code = Buffer.from(JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('did:plc:123');
    expect(r.accessToken).toBe('access-jwt');
    expect(r.name).toBe('Test User');
    expect(r.picture).toBe('https://ex.com/avatar.jpg');
    expect(r.username).toBe('testhandle');
  });

  it('authenticate returns error string on invalid', async () => {
    mockBskyAgent.login.mockRejectedValueOnce(new Error('Invalid'));
    const code = Buffer.from(JSON.stringify({ service: 'https://bsky.social', identifier: 'bad', password: 'bad' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post without media', async () => {
    const integration = { customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }) } as any;
    const r = await provider.post('did:plc:123', 'tok', [{ id: 'p1', message: 'Hello Bluesky!', settings: {}, media: [] }], integration);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('at://did:plc:123/app.bsky.feed.post/post-123');
    expect(r[0].releaseURL).toContain('bsky.app');
  });

  it('post with images', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('image-data').buffer),
      json: vi.fn(),
      text: vi.fn(),
      headers: new Map(),
    });
    const integration = { customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }) } as any;
    const r = await provider.post('did:plc:123', 'tok', [{ id: 'p1', message: 'With image', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }], integration);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toContain('post');
  });

  it('post with video', async () => {
    const integration = { customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }) } as any;
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('video-data').buffer), json: vi.fn(), text: vi.fn(), headers: new Map() }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ jobId: 'job-123', blob: undefined }), text: vi.fn(), headers: new Map() }));
    const r = await provider.post('did:plc:123', 'tok', [{ id: 'p1', message: 'With video', settings: {}, media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }] }], integration);
    expect(r).toHaveLength(1);
  });

  it('comment replies to a post', async () => {
    const integration = { customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }) } as any;
    const r = await provider.comment('did:plc:123', 'at://parent/post-123', undefined, 'tok', [{ id: 'c1', message: 'Great post!', settings: {}, media: [] }], integration);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toContain('post');
  });

  it('comment with lastCommentId', async () => {
    const integration = { customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }) } as any;
    const r = await provider.comment('did:plc:123', 'at://parent/post-123', 'at://parent/existing', 'tok', [{ id: 'c2', message: 'Reply chain', settings: {}, media: [] }], integration);
    expect(r).toHaveLength(1);
  });

  it('mention searches actors', async () => {
    const integration = { customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }) } as any;
    const r = await provider.mention('tok', { query: 'test' }, 'did:plc:123', integration);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('testactor');
    expect(r[0].label).toBe('Test Actor');
  });

  it('mentionFormat formats correctly', () => {
    expect(provider.mentionFormat('testhandle', 'Test User')).toBe('@testhandle');
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(3);
    expect(r[0].key).toBe('service');
    expect(r[1].key).toBe('identifier');
    expect(r[2].key).toBe('password');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. LEMMY PROVIDER
// ─────────────────────────────────────────────────────────────
describe('lemmy deep', () => {
  let provider: LemmyProvider;

  beforeEach(() => {
    provider = new LemmyProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 10000', () => {
    expect(provider.maxLength()).toBe(10000);
  });

  it('checkValidity rejects non-image cover', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with image', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.png' }]]);
    expect(r).toBe(true);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate logs in and fetches user', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ jwt: 'lemmy-jwt' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ person_view: { person: { id: 42, display_name: 'Test User', name: 'testuser', avatar: 'https://ex.com/av.jpg' } } })));
    const code = Buffer.from(JSON.stringify({ service: 'https://lemmy.world', identifier: 'testuser', password: 'pass' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('42');
    expect(r.accessToken).toBe('lemmy-jwt');
    expect(r.name).toBe('Test User');
  });

  it('authenticate returns invalid on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, json: vi.fn().mockResolvedValue({ error: 'wrong' }), text: vi.fn() });
    const code = Buffer.from(JSON.stringify({ service: 'https://lemmy.world', identifier: 'bad', password: 'bad' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post to multiple subreddits', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ jwt: 'lemmy-jwt' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ post_view: { post: { id: 101 } } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ post_view: { post: { id: 102 } } })));
    const r = await provider.post('42', 'tok', [{ id: 'p1', message: 'Hello Lemmy!', settings: { subreddit: [{ value: { id: '1', title: 'Post 1' } }, { value: { id: '2', title: 'Post 2' } }] }, media: [] }], { customInstanceDetails: JSON.stringify({ service: 'https://lemmy.world', identifier: 'testuser', password: 'pass' }) } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('101,102');
  });

  it('post with media and URL', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ jwt: 'lemmy-jwt' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ post_view: { post: { id: 201 } } })));
    const r = await provider.post('42', 'tok', [{ id: 'p1', message: 'With media', settings: { subreddit: [{ value: { id: '3', title: 'Post 3', url: 'https://example.com' } }] }, media: [{ path: 'https://ex.com/thumb.jpg' }] }], { customInstanceDetails: JSON.stringify({ service: 'https://lemmy.world', identifier: 'testuser', password: 'pass' }) } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('201');
  });

  it('comment on post (single postId)', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ jwt: 'lemmy-jwt' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ comment_view: { comment: { id: 301 } } })));
    const r = await provider.comment('42', '101', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], { customInstanceDetails: JSON.stringify({ service: 'https://lemmy.world', identifier: 'testuser', password: 'pass' }) } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('301');
  });

  it('comment on multiple postIds', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ jwt: 'lemmy-jwt' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ comment_view: { comment: { id: 401 } } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ comment_view: { comment: { id: 402 } } })));
    const r = await provider.comment('42', '101,102', undefined, 'tok', [{ id: 'c2', message: 'Multi reply', settings: {}, media: [] }], { customInstanceDetails: JSON.stringify({ service: 'https://lemmy.world', identifier: 'testuser', password: 'pass' }) } as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('401,402');
  });

  it('subreddits searches communities', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ jwt: 'lemmy-jwt' })))
      .mockImplementationOnce(() => Promise.resolve(resp({ communities: [{ community: { id: 1, title: 'Test Community' } }] })));
    const r = await provider.subreddits('tok', { word: 'test' }, '42', { customInstanceDetails: JSON.stringify({ service: 'https://lemmy.world', identifier: 'testuser', password: 'pass' }) } as any);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(1);
    expect(r[0].title).toBe('Test Community');
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(3);
    expect(r[0].key).toBe('service');
    expect(r[1].key).toBe('identifier');
    expect(r[2].key).toBe('password');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. NOSTR PROVIDER
// ─────────────────────────────────────────────────────────────
describe('nostr deep', () => {
  let provider: NostrProvider;

  beforeEach(() => {
    provider = new NostrProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 100000', () => {
    expect(provider.maxLength()).toBe(100000);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate derives pubkey and fetches relay info', async () => {
    const code = Buffer.from(JSON.stringify({ password: 'deadbeefdeadbeefdeadbeefdeadbeef' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('pubkey-123');
    expect(r.name).toBe('Test User');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
    expect(r.accessToken).toBe('signed-jwt');
  });

  it('authenticate returns invalid on error', async () => {
    mockNostrGetPublicKey.mockImplementationOnce(() => { throw new Error('fail'); });
    const code = Buffer.from(JSON.stringify({ password: 'aa' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post publishes text note', async () => {
    const r = await provider.post('pubkey-123', 'tok', [{ id: 'p1', message: 'Hello Nostr!', settings: {}, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('event-id-123');
    expect(r[0].releaseURL).toContain('primal.net');
  });

  it('post with media appends paths to content', async () => {
    const r = await provider.post('pubkey-123', 'tok', [{ id: 'p1', message: 'Check this', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r[0].postId).toBe('event-id-123');
  });

  it('comment publishes reply event', async () => {
    const r = await provider.comment('pubkey-123', 'post-abc', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('event-id-123');
  });

  it('comment with lastCommentId', async () => {
    const r = await provider.comment('pubkey-123', 'post-abc', 'existing-comment', 'tok', [{ id: 'c2', message: 'Reply chain', settings: {}, media: [] }], {} as any);
    expect(r[0].postId).toBe('event-id-123');
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('password');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. FARCASTER PROVIDER
// ─────────────────────────────────────────────────────────────
describe('farcaster deep', () => {
  let provider: FarcasterProvider;

  beforeEach(() => {
    provider = new FarcasterProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 800', () => {
    expect(provider.maxLength()).toBe(800);
  });

  it('checkValidity rejects video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]]);
    expect(r).not.toBe(true);
  });

  it('checkValidity passes with images', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]]);
    expect(r).toBe(true);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns URL with client ID', async () => {
    const r = await provider.generateAuthUrl({ client_id: 'neynar-client-id', client_secret: '', instanceUrl: '' });
    expect(r.url).toContain('neynar-client-id');
    expect(r).toHaveProperty('state');
    expect(r).toHaveProperty('codeVerifier');
  });

  it('authenticate decodes code without API calls', async () => {
    const code = Buffer.from(JSON.stringify({ fid: 123, display_name: 'Test User', signer_uuid: 'signer-123', pfp_url: 'https://ex.com/pic.jpg', username: 'testuser' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('123');
    expect(r.name).toBe('Test User');
    expect(r.accessToken).toBe('signer-123');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
    expect(r.username).toBe('testuser');
  });

  it('post publishes cast without channel', async () => {
    const r = await provider.post('123', 'signer-123', [{ id: 'p1', message: 'Hello Farcaster!', settings: {}, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('cast-hash-123');
  });

  it('post publishes cast with channel and media embeds', async () => {
    const r = await provider.post('123', 'signer-123', [{ id: 'p1', message: 'With media', settings: { subreddit: [{ value: { id: 'ch-1' } }] }, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('cast-hash-123');
  });

  it('comment replies to a cast', async () => {
    const r = await provider.comment('123', 'cast-parent', undefined, 'signer-123', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('cast-hash-123');
  });

  it('comment with multiple parentIds', async () => {
    const r = await provider.comment('123', 'cast-1,cast-2', undefined, 'signer-123', [{ id: 'c2', message: 'Multi reply', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
  });

  it('subreddits searches channels', async () => {
    const r = await provider.subreddits('tok', { word: 'test' }, '123', {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('ch-1');
    expect(r[0].name).toBe('Test Channel');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. TELEGRAM PROVIDER
// ─────────────────────────────────────────────────────────────
describe('telegram deep', () => {
  let provider: TelegramProvider;

  beforeEach(() => {
    provider = new TelegramProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 4096', () => {
    expect(provider.maxLength()).toBe(4096);
  });

  it('handleErrors returns undefined (no custom)', () => {
    expect(provider.handleErrors('any error')).toBeUndefined();
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches chat and returns info', async () => {
    const r = await provider.authenticate({ code: 'testchat', codeVerifier: 'v' });
    expect(r.id).toBe('testchat');
    expect(r.name).toBe('Test Chat');
    expect(r.accessToken).toBe('12345');
    expect(r.picture).toBe('https://ex.com/photo.jpg');
    expect(r.username).toBe('testchat');
  });

  it('authenticate returns no chat when not found', async () => {
    mockTelegramBot.getChat.mockResolvedValueOnce({} as any);
    const r = await provider.authenticate({ code: 'unknown', codeVerifier: 'v' });
    expect(r).toBe('No chat found');
  });

  it('authenticate handles missing photo', async () => {
    mockTelegramBot.getChat.mockResolvedValueOnce({ id: 67890, title: 'No Photo Chat', username: 'nophoto', photo: undefined });
    const r = await provider.authenticate({ code: 'nophoto', codeVerifier: 'v' });
    expect(r.picture).toBe('');
  });

  it('post sends text message (no media)', async () => {
    const r = await provider.post('testchat', '12345', [{ id: 'p1', message: 'Hello Telegram!', settings: {}, media: [] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('100');
    expect(r[0].releaseURL).toContain('t.me');
  });

  it('post sends photo (single image)', async () => {
    const r = await provider.post('testchat', '12345', [{ id: 'p1', message: 'With photo', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img.jpg' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('102');
  });

  it('post sends video (single video)', async () => {
    const r = await provider.post('testchat', '12345', [{ id: 'p1', message: 'With video', settings: {}, media: [{ type: 'video', path: 'https://ex.com/vid.mp4' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('101');
  });

  it('post sends document for non-image/video files', async () => {
    const r = await provider.post('testchat', '12345', [{ id: 'p1', message: 'With doc', settings: {}, media: [{ type: 'file', path: 'https://ex.com/doc.pdf' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('103');
  });

  it('post sends media group (multiple media)', async () => {
    const r = await provider.post('testchat', '12345', [{ id: 'p1', message: 'Media group', settings: {}, media: [{ type: 'image', path: 'https://ex.com/img1.jpg' }, { type: 'image', path: 'https://ex.com/img2.jpg' }] }]);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('104');
  });

  it('post returns empty when no messageId', async () => {
    mockTelegramBot.sendMessage.mockResolvedValueOnce({});
    const r = await provider.post('testchat', '12345', [{ id: 'p1', message: 'No ID', settings: {}, media: [] }]);
    expect(r).toEqual([]);
  });

  it('comment replies to a message', async () => {
    const r = await provider.comment('testchat', '100', undefined, '12345', [{ id: 'c1', message: 'Nice!', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('100');
  });

  it('comment with lastCommentId', async () => {
    const r = await provider.comment('testchat', '100', '99', '12345', [{ id: 'c2', message: 'Reply chain', settings: {}, media: [] }], {} as any);
    expect(r).toHaveLength(1);
  });

  it('getBotId returns empty when no match', async () => {
    const r = await provider.getBotId({ word: 'connect123', id: 1 });
    expect(r).toEqual({});
  });

  it('getBotId returns chatId when match found', async () => {
    mockTelegramBot.getUpdates.mockResolvedValueOnce([{ update_id: 1, message: { message_id: 10, text: '/connect testword', chat: { id: 777 } } }]);
    const r = await provider.getBotId({ word: 'testword' });
    expect(r).toEqual({ chatId: 777 });
  });

  it('botIsAdmin returns true when admin', async () => {
    const r = await provider.botIsAdmin(12345, 999);
    expect(r).toBe(true);
  });

  it('botIsAdmin returns false when not admin', async () => {
    mockTelegramBot.getChatMember.mockResolvedValueOnce({ status: 'member' });
    const r = await provider.botIsAdmin(12345, 999);
    expect(r).toBe(false);
  });

  it('botIsAdmin returns false on error', async () => {
    mockTelegramBot.getChatMember.mockRejectedValueOnce(new Error('fail'));
    const r = await provider.botIsAdmin(12345, 999);
    expect(r).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. MEDIUM PROVIDER
// ─────────────────────────────────────────────────────────────
describe('medium deep', () => {
  let provider: MediumProvider;

  beforeEach(() => {
    provider = new MediumProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 100000', () => {
    expect(provider.maxLength()).toBe(100000);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches user from API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { name: 'Test User', id: 'medium-123', imageUrl: 'https://ex.com/pic.jpg', username: 'testuser' } }));
    const code = Buffer.from(JSON.stringify({ apiKey: 'medium-api-key' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('medium-123');
    expect(r.name).toBe('Test User');
    expect(r.accessToken).toBe('medium-api-key');
    expect(r.username).toBe('testuser');
  });

  it('authenticate returns invalid on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
    const code = Buffer.from(JSON.stringify({ apiKey: 'bad-key' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post publishes to user', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'post-123', url: 'https://medium.com/p/post-123' } }));
    const r = await provider.post('medium-123', 'tok', [{ id: 'p1', message: 'Post content', settings: { title: 'My Post', tags: [{ value: 'javascript' }], canonical: 'https://ex.com/original' } }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('post-123');
    expect(r[0].releaseURL).toBe('https://medium.com/p/post-123');
  });

  it('post publishes to publication', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'pub-post-456', url: 'https://medium.com/p/pub-post-456' } }));
    const r = await provider.post('medium-123', 'tok', [{ id: 'p1', message: 'Pub post', settings: { title: 'Pub Post', publication: 'pub-456' } }], {} as any);
    expect(r[0].postId).toBe('pub-post-456');
  });

  it('publications fetches publication list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [{ id: 'pub-1', name: 'My Pub' }] }));
    const r = await provider.publications('tok', {}, 'medium-123');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('pub-1');
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('apiKey');
  });
});

// ─────────────────────────────────────────────────────────────
// 7. DEV.TO PROVIDER
// ─────────────────────────────────────────────────────────────
describe('devto deep', () => {
  let provider: DevToProvider;

  beforeEach(() => {
    provider = new DevToProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 100000', () => {
    expect(provider.maxLength()).toBe(100000);
  });

  it('handleErrors returns bad-body for canonical url taken', () => {
    const r = provider.handleErrors('Canonical url has already been taken');
    expect(r?.type).toBe('bad-body');
    expect(r?.value).toBe('Canonical URL already exists');
  });

  it('handleErrors returns undefined for others', () => {
    expect(provider.handleErrors('Some other error')).toBeUndefined();
  });

  it('propagates BadBodyError when post hits a canonical-url error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('Canonical url has already been taken', 422));
    await expect(provider.post('user-123', 'devto-api-key', [{ id: 'p1', message: 'Content', settings: { title: 'My Article', canonical: 'https://ex.com/orig' } }], {} as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches user from API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ name: 'Test User', id: 123, profile_image: 'https://ex.com/pic.jpg', username: 'testuser' }));
    const code = Buffer.from(JSON.stringify({ apiKey: 'devto-api-key' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe(123);
    expect(r.name).toBe('Test User');
    expect(r.accessToken).toBe('devto-api-key');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
  });

  it('authenticate returns invalid on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const code = Buffer.from(JSON.stringify({ apiKey: 'bad' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post publishes article', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 456, url: 'https://dev.to/testuser/my-article' }));
    const r = await provider.post('user-123', 'devto-api-key', [{ id: 'p1', message: '# Hello\n\nContent here', settings: { title: 'My Article', tags: [{ label: 'javascript' }], main_image: { path: 'https://ex.com/cover.jpg' }, canonical: 'https://ex.com/orig', organization: 5 } }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('456');
    expect(r[0].releaseURL).toBe('https://dev.to/testuser/my-article');
  });

  it('post publishes without optional settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 789, url: 'https://dev.to/p/789' }));
    const r = await provider.post('user-123', 'tok', [{ id: 'p1', message: 'Simple post', settings: { title: 'Simple' } }], {} as any);
    expect(r[0].postId).toBe('789');
  });

  it('tags fetches tag list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp([{ id: 1, name: 'javascript' }]));
    const r = await provider.tags('tok');
    expect(r).toHaveLength(1);
  });

  it('organizations fetches org list', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp([{ organization: { username: 'testorg' } }])))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 10, name: 'Test Org', username: 'testorg' })));
    const r = await provider.organizations('tok');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Test Org');
  });

  it('organizations returns empty when no orgs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp([]));
    const r = await provider.organizations('tok');
    expect(r).toEqual([]);
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('apiKey');
  });
});

// ─────────────────────────────────────────────────────────────
// 8. HASHNODE PROVIDER
// ─────────────────────────────────────────────────────────────
describe('hashnode deep', () => {
  let provider: HashnodeProvider;

  beforeEach(() => {
    provider = new HashnodeProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 10000', () => {
    expect(provider.maxLength()).toBe(10000);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches user via GraphQL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { me: { name: 'Test User', id: 'hashnode-123', profilePicture: 'https://ex.com/pic.jpg', username: 'testuser' } } }));
    const code = Buffer.from(JSON.stringify({ apiKey: 'hashnode-key' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('hashnode-123');
    expect(r.name).toBe('Test User');
    expect(r.accessToken).toBe('hashnode-key');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
    expect(r.username).toBe('testuser');
  });

  it('authenticate returns invalid on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const code = Buffer.from(JSON.stringify({ apiKey: 'bad' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post publishes via GraphQL mutation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { publishPost: { post: { id: 'hn-post-123', url: 'https://hashnode.dev/p/hn-post-123' } } } }));
    const r = await provider.post('hashnode-123', 'tok', [{ id: 'p1', message: '# Hello\n\nContent', settings: { title: 'My Post', publication: 'pub-1', tags: [{ value: '123' }], subtitle: 'Subtitle', canonical: 'https://ex.com/orig', main_image: { path: 'https://ex.com/cover.jpg' } } }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('hn-post-123');
    expect(r[0].releaseURL).toBe('https://hashnode.dev/p/hn-post-123');
  });

  it('post without optional settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { publishPost: { post: { id: 'hn-post-456', url: 'https://hashnode.dev/p/456' } } } }));
    const r = await provider.post('hashnode-123', 'tok', [{ id: 'p1', message: 'Simple', settings: { title: 'Simple', publication: 'pub-1', tags: [] } }], {} as any);
    expect(r[0].postId).toBe('hn-post-456');
  });

  it('tags returns static tag list', async () => {
    const r = await provider.tags();
    expect(r).toBeInstanceOf(Array);
    expect(r.length).toBeGreaterThan(0);
  });

  it('tagsList returns static tags', () => {
    const r = provider.tagsList();
    expect(r).toBeInstanceOf(Array);
  });

  it('publications fetches via GraphQL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { me: { publications: { edges: [{ node: { id: 'pub-1', title: 'My Publication' } }] } } } }));
    const r = await provider.publications('tok');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('pub-1');
    expect(r[0].name).toBe('My Publication');
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('apiKey');
  });
});

// ─────────────────────────────────────────────────────────────
// 9. WORDPRESS PROVIDER
// ─────────────────────────────────────────────────────────────
describe('wordpress deep', () => {
  let provider: WordpressProvider;

  beforeEach(() => {
    provider = new WordpressProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 100000', () => {
    expect(provider.maxLength()).toBe(100000);
  });

  it('handleErrors returns bad-body for rest_cannot_create', () => {
    const r = provider.handleErrors('rest_cannot_create');
    expect(r?.type).toBe('bad-body');
    expect(r?.value).toContain('insufficient permissions');
  });

  it('handleErrors returns undefined for other errors', () => {
    expect(provider.handleErrors('other error')).toBeUndefined();
  });

  it('propagates BadBodyError when post hits rest_cannot_create', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('rest_cannot_create', 403));
    const accessToken = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'admin', password: 'pass' })).toString('base64');
    await expect(provider.post('https://example.com_42', accessToken, [{ id: 'p1', message: '<p>Hello WordPress!</p>', settings: { title: 'My Post', type: 'posts' } }], {} as any)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches user via WP REST API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 42, name: 'Test User', avatar_urls: { '24': 'https://ex.com/24.jpg', '48': 'https://ex.com/48.jpg', '96': 'https://ex.com/96.jpg' } }));
    const code = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('https://example.com_42');
    expect(r.name).toBe('Test User');
    expect(r.picture).toBe('https://ex.com/96.jpg');
    expect(r.username).toBe('admin');
  });

  it('authenticate returns invalid on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const code = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('authenticate handles error code in response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ code: 'rest_user_invalid' }));
    const code = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'bad', password: 'bad' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post without media', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 789, link: 'https://example.com/post-789' }));
    const accessToken = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.post('https://example.com_42', accessToken, [{ id: 'p1', message: '<p>Hello WordPress!</p>', settings: { title: 'My Post', type: 'posts' } }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('789');
    expect(r[0].releaseURL).toBe('https://example.com/post-789');
  });

  it('post with featured image', async () => {
    const blobResponse = { status: 200, ok: true, blob: vi.fn().mockResolvedValue({ type: 'image/jpeg' }), json: vi.fn(), text: vi.fn(), headers: new Map() };
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(blobResponse))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 555 })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 999, link: 'https://example.com/post-999' })));
    const accessToken = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.post('https://example.com_42', accessToken, [{ id: 'p1', message: '<p>With image</p>', settings: { title: 'Featured Post', type: 'posts', main_image: { path: 'https://ex.com/cover.jpg' } } }], {} as any);
    expect(r[0].postId).toBe('999');
  });

  it('postTypes fetches available types', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ posts: { rest_base: 'posts', name: 'Posts' }, pages: { rest_base: 'pages', name: 'Pages' }, wp_block: { rest_base: 'wp_block', name: 'Blocks' }, attachment: { rest_base: 'attachment', name: 'Media' } }));
    const accessToken = Buffer.from(JSON.stringify({ domain: 'https://example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.postTypes(accessToken);
    expect(r).toHaveLength(2);
    expect(r.find((p: any) => p.id === 'posts')).toBeTruthy();
    expect(r.find((p: any) => p.id === 'pages')).toBeTruthy();
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(3);
    expect(r[0].key).toBe('domain');
    expect(r[1].key).toBe('username');
    expect(r[2].key).toBe('password');
  });
});

// ─────────────────────────────────────────────────────────────
// 10. LISTMONK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('listmonk deep', () => {
  let provider: ListmonkProvider;

  beforeEach(() => {
    provider = new ListmonkProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 100000000', () => {
    expect(provider.maxLength()).toBe(100000000);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches settings and returns info', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { 'app.site_name': 'My ListMonk', 'app.logo_url': 'https://ex.com/logo.png' } }));
    const code = Buffer.from(JSON.stringify({ url: 'https://listmonk.example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBeTruthy();
    expect(r.name).toBe('My ListMonk');
    expect(r.picture).toBe('https://ex.com/logo.png');
    expect(r.username).toBe('My ListMonk');
  });

  it('authenticate returns invalid on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const code = Buffer.from(JSON.stringify({ url: 'https://listmonk.example.com', username: 'admin', password: 'pass' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid credentials');
  });

  it('post creates campaign and starts it', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { uuid: 'campaign-uuid', id: 42 } })))
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const integration = { customInstanceDetails: JSON.stringify({ url: 'https://listmonk.example.com', username: 'admin', password: 'pass' }) } as any;
    const r = await provider.post('id', 'tok', [{ id: 'p1', message: '<p>Email content</p>', settings: { subject: 'My Campaign', list: '1', template: '2', preview: 'Preview text' } }], integration);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('campaign-uuid');
    expect(r[0].releaseURL).toContain('/api/campaigns/42/preview');
  });

  it('post without template', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ data: { uuid: 'campaign-uuid-2', id: 43 } })))
      .mockImplementationOnce(() => Promise.resolve(resp({})));
    const integration = { customInstanceDetails: JSON.stringify({ url: 'https://listmonk.example.com', username: 'admin', password: 'pass' }) } as any;
    const r = await provider.post('id', 'tok', [{ id: 'p1', message: '<p>No template</p>', settings: { subject: 'Simple', list: '2' } }], integration);
    expect(r[0].postId).toBe('campaign-uuid-2');
  });

  it('list fetches mailing lists', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { results: [{ id: 1, name: 'List 1' }] } }));
    const integration = { customInstanceDetails: JSON.stringify({ url: 'https://listmonk.example.com', username: 'admin', password: 'pass' }) } as any;
    const r = await provider.list('tok', {}, 'id', integration);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(1);
  });

  it('templates fetches template list including default', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [{ id: 1, name: 'Template 1' }] }));
    const integration = { customInstanceDetails: JSON.stringify({ url: 'https://listmonk.example.com', username: 'admin', password: 'pass' }) } as any;
    const r = await provider.templates('tok', {}, 'id', integration);
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe(0);
    expect(r[0].name).toBe('Default');
    expect(r[1].id).toBe(1);
  });

  it('customFields returns expected fields', async () => {
    const r = await provider.customFields();
    expect(r).toHaveLength(3);
    expect(r[0].key).toBe('url');
    expect(r[1].key).toBe('username');
    expect(r[2].key).toBe('password');
  });
});

// ─────────────────────────────────────────────────────────────
// 11. SKOOL PROVIDER
// ─────────────────────────────────────────────────────────────
describe('skool deep', () => {
  let provider: SkoolProvider;

  beforeEach(() => {
    provider = new SkoolProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 5000', () => {
    expect(provider.maxLength()).toBe(5000);
  });

  it('handleErrors returns bad-body for admin level error', () => {
    const r = provider.handleErrors('must be admin or level');
    expect(r?.type).toBe('bad-body');
    expect(r?.value).toContain('post to this channel');
  });

  it('handleErrors returns bad-body for label error', () => {
    const r = provider.handleErrors('cannot post to this label');
    expect(r?.type).toBe('bad-body');
  });

  it('handleErrors returns undefined for unknown', () => {
    expect(provider.handleErrors('ok')).toBeUndefined();
  });

  it('propagates BadBodyError when post encounters a bad-body error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respError('must be admin or level', 403));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'client-123', auth_token: 'auth-token-123' }) } as any;
    await expect(provider.post('user-123', 'tok', [{ id: 'p1', message: 'Hello Skool!', settings: { group: 'group-1', title: 'My Post' } }], integration)).rejects.toThrow(BadBodyError);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches self and returns info', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'user-123', first_name: 'John', last_name: 'Doe', metadata: { picture_profile: 'https://ex.com/pic.jpg' }, name: 'JohnDoe' }));
    const code = Buffer.from(JSON.stringify({ client_id: 'client-123', auth_token: 'auth-token-123' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r.id).toBe('user-123');
    expect(r.name).toBe('John Doe');
    expect(r.picture).toBe('https://ex.com/pic.jpg');
    expect(r.username).toBe('JohnDoe');
  });

  it('authenticate returns message when missing cookies', async () => {
    const code = Buffer.from(JSON.stringify({})).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toContain('Missing required cookies');
  });

  it('authenticate returns invalid on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const code = Buffer.from(JSON.stringify({ client_id: 'c', auth_token: 'a' })).toString('base64');
    const r = await provider.authenticate({ code, codeVerifier: 'v' });
    expect(r).toBe('Invalid cookie data');
  });

  it('post creates post with media upload', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('file').buffer), headers: new Map([['content-type', 'image/jpeg']]), json: vi.fn(), text: vi.fn() }))
      .mockImplementationOnce(() => Promise.resolve(resp({ write_url: 'https://upload.ex.com/file', content_type: 'image/jpeg', acl: 'private', file: { id: 'file-123' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({})))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'skool-post-1', name: 'my-post-title' })));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'client-123', auth_token: 'auth-token-123' }) } as any;
    const r = await provider.post('user-123', 'tok', [{ id: 'p1', message: 'Hello Skool!', settings: { group: 'group-1', title: 'My Post', label: 'label-1' }, media: [{ path: 'https://ex.com/img.jpg' }] }], integration);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('skool-post-1');
    expect(r[0].releaseURL).toContain('skool.com');
  });

  it('post without media or label', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'skool-post-2', name: 'simple-post' })));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'client-123', auth_token: 'auth-token-123' }) } as any;
    const r = await provider.post('user-123', 'tok', [{ id: 'p1', message: 'Simple', settings: { group: 'group-1', title: 'Simple' } }], integration);
    expect(r[0].postId).toBe('skool-post-2');
  });

  it('comment creates comment post', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'skool-comment-1', name: 'comment-title' })));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'client-123', auth_token: 'auth-token-123' }) } as any;
    const r = await provider.comment('user-123', 'post-abc', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: { group: 'group-1' }, media: [] }], integration);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('skool-comment-1');
  });

  it('comment with lastCommentId', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'skool-comment-2', name: 'reply-title' })));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'client-123', auth_token: 'auth-token-123' }) } as any;
    const r = await provider.comment('user-123', 'post-abc', 'parent-comment', 'tok', [{ id: 'c2', message: 'Reply', settings: { group: 'group-1' }, media: [] }], integration);
    expect(r[0].postId).toBe('skool-comment-2');
  });

  it('groups fetches user groups', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ groups: [{ id: 1, metadata: { display_name: 'Group 1' } }] }));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'c', auth_token: 'a' }) } as any;
    const r = await provider.groups('tok', {}, 'user-123', integration);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Group 1');
  });

  it('groups returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'c', auth_token: 'a' }) } as any;
    const r = await provider.groups('tok', {}, 'user-123', integration);
    expect(r).toEqual([]);
  });

  it('label fetches labels with single label id', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(resp({ metadata: { labels: 'label-1' } })))
      .mockImplementationOnce(() => Promise.resolve(resp({ id: 'label-1', metadata: { display_name: 'Label 1' } })));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'c', auth_token: 'a' }) } as any;
    const r = await provider.label('tok', { id: 'group-1' }, 'user-123', integration);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Label 1');
  });

  it('label returns default when no labels', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resp({ metadata: {} }));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'c', auth_token: 'a' }) } as any;
    const r = await provider.label('tok', { id: 'group-1' }, 'user-123', integration);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Default Label');
  });

  it('label returns empty on error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    const integration = { customInstanceDetails: JSON.stringify({ client_id: 'c', auth_token: 'a' }) } as any;
    const r = await provider.label('tok', { id: 'group-1' }, 'user-123', integration);
    expect(r).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 12. MOLTBOOK PROVIDER
// ─────────────────────────────────────────────────────────────
describe('moltbook deep', () => {
  let provider: MoltbookProvider;

  beforeEach(() => {
    provider = new MoltbookProvider();
    globalThis.fetch = vi.fn();
  });

  it('maxLength returns 300', () => {
    expect(provider.maxLength()).toBe(300);
  });

  it('refreshToken returns static value', async () => {
    const r = await provider.refreshToken('tok');
    expect(r.accessToken).toBe('');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('authenticate fetches agent profile', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, agent: { id: 'agent-123', name: 'TestAgent', display_name: 'Test Agent' } }));
    const r = await provider.authenticate({ code: 'molt-api-key', codeVerifier: 'v' });
    expect(r.id).toBe('TestAgent');
    expect(r.name).toBe('Test Agent');
    expect(r.accessToken).toBe('molt-api-key');
  });

  it('post creates post via API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, post: { id: 'molt-post-1' } }));
    const r = await provider.post('agent-123', 'molt-api-key', [{ id: 'p1', message: 'Hello Moltbook!', settings: { submolt: 'general' } }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('molt-post-1');
    expect(r[0].releaseURL).toContain('moltbook.com');
  });

  it('post with default submolt', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, post: { id: 'molt-post-2' } }));
    const r = await provider.post('agent-123', 'molt-api-key', [{ id: 'p1', message: 'Default submolt', settings: {} }], {} as any);
    expect(r[0].postId).toBe('molt-post-2');
  });

  it('comment creates comment on post', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, comment: { id: 'molt-comment-1' } }));
    const r = await provider.comment('agent-123', 'molt-post-1', undefined, 'molt-api-key', [{ id: 'c1', message: 'Nice!', settings: {} }], {} as any);
    expect(r).toHaveLength(1);
    expect(r[0].postId).toBe('molt-comment-1');
  });

  it('comment with lastCommentId', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, comment: { id: 'molt-comment-2' } }));
    const r = await provider.comment('agent-123', 'molt-post-1', 'parent-comment', 'molt-api-key', [{ id: 'c2', message: 'Reply', settings: {} }], {} as any);
    expect(r[0].postId).toBe('molt-comment-2');
  });

  it('registerAgent registers new agent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, agent: { id: 'new-agent', name: 'MyBot' } }));
    const r = await provider.registerAgent('MyBot', 'A test bot');
    expect(r.id).toBe('new-agent');
    expect(r.name).toBe('MyBot');
  });

  it('checkAgentStatus returns status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ status: 'active' }));
    const r = await provider.checkAgentStatus('api-key');
    expect(r.status).toBe('active');
  });

  it('getAgentProfile fetches profile', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(resp({ success: true, agent: { id: 'agent-123', name: 'TestAgent' } }));
    const r = await provider.getAgentProfile('api-key');
    expect(r.name).toBe('TestAgent');
  });
});
