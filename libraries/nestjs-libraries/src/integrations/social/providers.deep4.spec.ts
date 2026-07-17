import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  getOrgCredential: (orgId: string, integration: string, key: string) => {
    if (key === 'clientId') return 'mock-client-id';
    if (key === 'clientSecret') return 'mock-client-secret';
    return 'mock-value';
  },
  setCredentials: vi.fn(),
  getCredential: vi.fn(() => undefined),
  clearCredentials: vi.fn(),
  replaceCredentialsMap: vi.fn(),
}));
vi.mock('form-data', () => ({ default: class FormData { append = vi.fn(); } }));

import { RefreshTokenError, BadBodyError } from '@gitroom/nestjs-libraries/inngest/errors';
import { TumblrProvider } from './tumblr.provider';
import { PixelfedProvider } from './pixelfed.provider';
import { PeerTubeProvider } from './peertube.provider';
import { getProviderMock } from './provider-mocks';

function respError(body: string, status: number) {
  return {
    status, ok: false,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
    headers: new Map(),
  };
}

// ─────────────────────────────────────────────────────────────
// TUMBLR
// ─────────────────────────────────────────────────────────────
describe('tumblr deep', () => {
  let provider: TumblrProvider;

  beforeEach(() => {
    provider = new TumblrProvider();
    globalThis.fetch = vi.fn();
  });

  it('has correct identifier and name', () => {
    expect(provider.identifier).toBe('tumblr');
    expect(provider.name).toBe('Tumblr');
  });

  it('maxLength returns 4096', () => {
    expect(provider.maxLength()).toBe(4096);
  });

  it('maxConcurrentJob is 3', () => {
    expect(provider.maxConcurrentJob).toBe(3);
  });

  it('editor is normal', () => {
    expect(provider.editor).toBe('normal');
  });

  it('post omits text block for media-only posts (empty message)', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(new Blob(['img'])) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: '', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r[0].postId).toBe('post-123');
  });

  it('scopes include basic, write, offline_access', () => {
    expect(provider.scopes).toContain('basic');
    expect(provider.scopes).toContain('write');
    expect(provider.scopes).toContain('offline_access');
  });

  it('generateAuthUrl returns URL with tumblr.com/oauth2/authorize', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toContain('tumblr.com/oauth2/authorize');
    expect(r.url).toContain('redirect_uri');
  });

  it('checkValidity returns true for text-only post', async () => {
    const r = await provider.checkValidity([[]]);
    expect(r).toBe(true);
  });

  it('authenticate with mocked fetch returns AuthTokenDetails', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.tokenResponse) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.userResponse) });

    const r = await provider.authenticate({ code: 'auth-code', codeVerifier: 'v' });
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('accessToken');
    expect(r).toHaveProperty('refreshToken');
    expect(r).toHaveProperty('expiresIn');
    expect(r).toHaveProperty('picture');
    expect(r).toHaveProperty('username');
  });

  it('refreshToken returns token details', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.tokenResponse) });

    const r = await provider.refreshToken('old-refresh-token');
    expect(r).toHaveProperty('accessToken');
    expect(r).toHaveProperty('refreshToken');
  });

  it('post sends text-only post', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }]);
    expect(r[0].postId).toBe('post-123');
    expect(r[0].releaseURL).toBe('https://testblog.tumblr.com/post/post-123');
  });

  it('post throws error when no postId returned', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });

    await expect(provider.post('testblog', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }])).rejects.toThrow('Failed to create Tumblr post - no post ID returned');
  });

  it('propagates RefreshTokenError on 401 from fetch', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(respError('Unauthorized', 401));

    await expect(provider.post('testblog', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }])).rejects.toThrow(RefreshTokenError);
  });

  it('propagates BadBodyError on 400 from fetch', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce(respError('Bad Request', 400));

    await expect(provider.post('testblog', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }])).rejects.toThrow(BadBodyError);
  });

  it('authenticate throws when no blogs returned', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.tokenResponse) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ response: { user: { blogs: [] } } }) });

    await expect(provider.authenticate({ code: 'auth-code', codeVerifier: 'v' })).rejects.toThrow('No Tumblr blog found for this account');
  });

  it('post uploads media files and creates post', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(new Blob(['img'])) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [{ path: 'https://ex.com/img.jpg', alt: 'My alt text' }] }]);
    expect(r[0].postId).toBe('post-123');
    expect(r[0].releaseURL).toBe('https://testblog.tumblr.com/post/post-123');
  });

  it('refreshToken falls back to refreshToken param when refresh_token missing from response', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'new-tok' }) });

    const r = await provider.refreshToken('old-refresh-token');
    expect(r.accessToken).toBe('new-tok');
    expect(r.refreshToken).toBe('old-refresh-token');
  });

  it('refreshToken defaults expiresIn to 3600 when expires_in missing from response', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'tok', refresh_token: 'rtok' }) });

    const r = await provider.refreshToken('old-refresh');
    expect(r.expiresIn).toBe(3600);
  });

  it('post handles undefined media (no media property) gracefully', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: 'No media prop', settings: {} }]);
    expect(r[0].postId).toBe('post-123');
    expect(r[0].releaseURL).toBe('https://testblog.tumblr.com/post/post-123');
  });

  it('post uploads video media (mp4 branch)', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(new Blob(['vid'])) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: 'Video post', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }]);
    expect(r[0].postId).toBe('post-123');
    expect(r[0].releaseURL).toBe('https://testblog.tumblr.com/post/post-123');
  });

  it('post uploads media without alt text (no alt_text appended)', async () => {
    const mock = getProviderMock('tumblr');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(new Blob(['img'])) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: 'No alt', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }]);
    expect(r[0].postId).toBe('post-123');
    expect(r[0].releaseURL).toBe('https://testblog.tumblr.com/post/post-123');
  });

  it('authenticate falls back to blog name when title is missing, and defaults refreshToken/expiresIn', async () => {
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'tok-only' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ response: { user: { blogs: [{ name: 'justblog', avatar: [] }] } } }) });

    const r = await provider.authenticate({ code: 'code', codeVerifier: 'v' });
    expect((r as any).name).toBe('justblog');
    expect((r as any).picture).toBe('');
    expect((r as any).accessToken).toBe('tok-only');
    expect((r as any).refreshToken).toBe('');
    expect((r as any).expiresIn).toBe(3600);
  });

  it('post uses response.id when id_string is missing', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ response: { id: 456 } }) });

    const r = await provider.post('testblog', 'tok', [{ id: 'p1', message: 'Hello', settings: {}, media: [] }]);
    expect(r[0].postId).toBe('456');
    expect(r[0].releaseURL).toBe('https://testblog.tumblr.com/post/456');
  });
});

// ─────────────────────────────────────────────────────────────
// PIXELFED
// ─────────────────────────────────────────────────────────────
describe('pixelfed deep', () => {
  let provider: PixelfedProvider;

  beforeEach(() => {
    provider = new PixelfedProvider();
    globalThis.fetch = vi.fn();
  });

  it('has correct identifier and name', () => {
    expect(provider.identifier).toBe('pixelfed');
    expect(provider.name).toBe('Pixelfed');
  });

  it('maxLength returns 500', () => {
    expect(provider.maxLength()).toBe(500);
  });

  it('maxConcurrentJob is 3', () => {
    expect(provider.maxConcurrentJob).toBe(3);
  });

  it('editor is normal', () => {
    expect(provider.editor).toBe('normal');
  });

  it('customFields returns instance and token fields', async () => {
    const fields = await provider.customFields();
    expect(fields).toHaveLength(2);
    expect(fields[0].key).toBe('instance');
    expect(fields[1].key).toBe('token');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('checkValidity rejects empty media', async () => {
    const r = await provider.checkValidity([[]]);
    expect(r).toBe('Pixelfed requires at least one image');
  });

  it('checkValidity rejects more than 10 images', async () => {
    const media = Array(11).fill({ path: 'https://ex.com/img.jpg' });
    const r = await provider.checkValidity([media]);
    expect(r).toBe('Pixelfed supports up to 10 images');
  });

  it('checkValidity rejects video', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]]);
    expect(r).toBe('Pixelfed supports images only');
  });

  it('checkValidity accepts valid image', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/img.jpg' }]]);
    expect(r).toBe(true);
  });

  it('refreshToken returns static empty value', async () => {
    const r = await provider.refreshToken();
    expect(r.accessToken).toBe('');
  });

  it('authenticate with base64-encoded customFields', async () => {
    const mock = getProviderMock('pixelfed');
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' })).toString('base64');
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.userResponse) });

    const r = await provider.authenticate({ code: base64Str, codeVerifier: 'none' });
    expect(r).not.toBeInstanceOf(String);
    expect((r as any).id).toBe('123');
    expect((r as any).name).toBe('Test User');
    expect((r as any).accessToken).toBe('test-token');
  });

  it('authenticate rejects invalid token', async () => {
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://pixelfed.example', token: 'bad-token' })).toString('base64');
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: undefined }) });

    const r = await provider.authenticate({ code: base64Str, codeVerifier: 'none' });
    expect(r).toBe('Invalid Pixelfed token or instance');
  });

  it('post uploads media and creates status', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(Buffer.from('img')) })  // media file fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: 'media-1' }) })  // media upload
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: 'post-1', url: 'https://ex.com/post/1' }) });  // status create

    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Test', settings: {}, media: [{ path: 'https://ex.com/img.jpg' }] }], integration);
    expect(r[0].postId).toBe('post-1');
    expect(r[0].releaseURL).toBe('https://ex.com/post/1');
  });

  it('comment posts reply', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' }) } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: 'comment-1', url: 'https://ex.com/comment/1' }) });

    const r = await provider.comment('123', 'parent-post-id', undefined, 'tok', [{ id: 'c1', message: 'Nice!', settings: {} }], integration);
    expect(r[0].postId).toBe('comment-1');
    expect(r[0].releaseURL).toBe('https://ex.com/comment/1');
  });

  it('authenticate handles profile without display_name or avatar', async () => {
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' })).toString('base64');
    (globalThis as any).fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: vi.fn().mockResolvedValue({ id: '123', username: 'testuser' })
    });

    const r = await provider.authenticate({ code: base64Str, codeVerifier: 'none' });
    expect(r).not.toBeInstanceOf(String);
    expect((r as any).id).toBe('123');
    expect((r as any).name).toBe('testuser');
    expect((r as any).picture).toBe('');
  });

  it('post uploads media with alt text', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(Buffer.from('img')) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: 'media-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: 'post-1', url: 'https://ex.com/post/1' }) });

    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Test with alt', settings: {}, media: [{ path: 'https://ex.com/img.jpg', alt: 'A beautiful sunset' }] }], integration);
    expect(r[0].postId).toBe('post-1');
    expect(r[0].releaseURL).toBe('https://ex.com/post/1');
  });

  it('post with no media handles undefined media gracefully', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: 'post-1', url: 'https://ex.com/post/1' }) });

    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Text only', settings: {} }], integration);
    expect(r[0].postId).toBe('post-1');
    expect(r[0].releaseURL).toBe('https://ex.com/post/1');
  });

  it('propagates RefreshTokenError on 401 from fetch', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' }) } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValue(respError('Unauthorized', 401));

    await expect(provider.post('123', 'tok', [{ id: 'p1', message: 'Text only', settings: {} }], integration)).rejects.toThrow(RefreshTokenError);
  });

  it('propagates BadBodyError on 400 from fetch', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://pixelfed.example', token: 'test-token' }) } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValue(respError('Bad Request', 400));

    await expect(provider.post('123', 'tok', [{ id: 'p1', message: 'Text only', settings: {} }], integration)).rejects.toThrow(BadBodyError);
  });
});

// ─────────────────────────────────────────────────────────────
// PEERTUBE
// ─────────────────────────────────────────────────────────────
describe('peertube deep', () => {
  let provider: PeerTubeProvider;

  beforeEach(() => {
    provider = new PeerTubeProvider();
    globalThis.fetch = vi.fn();
  });

  it('has correct identifier and name', () => {
    expect(provider.identifier).toBe('peertube');
    expect(provider.name).toBe('PeerTube');
  });

  it('maxLength returns 10000', () => {
    expect(provider.maxLength()).toBe(10000);
  });

  it('maxConcurrentJob is 2', () => {
    expect(provider.maxConcurrentJob).toBe(2);
  });

  it('editor is normal', () => {
    expect(provider.editor).toBe('normal');
  });

  it('customFields returns instance, username, password fields', async () => {
    const fields = await provider.customFields();
    expect(fields).toHaveLength(3);
    expect(fields[0].key).toBe('instance');
    expect(fields[1].key).toBe('username');
    expect(fields[2].key).toBe('password');
  });

  it('generateAuthUrl returns state-based URL', async () => {
    const r = await provider.generateAuthUrl();
    expect(r).toHaveProperty('url');
    expect(r).toHaveProperty('codeVerifier');
    expect(r).toHaveProperty('state');
    expect(r.url).toBe(r.state);
  });

  it('checkValidity rejects empty media', async () => {
    const r = await provider.checkValidity([[]]);
    expect(r).toBe('PeerTube requires a video file');
  });

  it('checkValidity rejects more than 1 file', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }, { path: 'https://ex.com/vid2.mp4' }]]);
    expect(r).toBe('PeerTube accepts one video per post');
  });

  it('checkValidity rejects non-mp4 file', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.avi' }]]);
    expect(r).toBe('PeerTube requires an .mp4 video');
  });

  it('checkValidity accepts valid mp4', async () => {
    const r = await provider.checkValidity([[{ path: 'https://ex.com/vid.mp4' }]]);
    expect(r).toBe(true);
  });

  it('refreshToken returns static empty value', async () => {
    const r = await provider.refreshToken();
    expect(r.accessToken).toBe('');
  });

  it('authenticate with base64-encoded customFields', async () => {
    const mock = getProviderMock('peertube');
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' })).toString('base64');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.userResponse) });

    const r = await provider.authenticate({ code: base64Str, codeVerifier: 'none' });
    expect((r as any).id).toBe('123');
    expect((r as any).accessToken).toBe('pt-tok');
    expect((r as any).username).toBe('testuser');
  });

  it('post uploads video', async () => {
    const mock = getProviderMock('peertube');
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.userResponse) })
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(Buffer.from('vid')) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(mock.postResponse) });

    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Test vid', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }], integration);
    expect(r[0].postId).toBe('vid-123');
    expect(r[0].releaseURL).toBe('https://peertube.example/w/abc-123');
  });

  it('comment posts to comment-threads', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ comment: { id: 'comment-1' } }) });

    const r = await provider.comment('123', 'vid-123', undefined, 'tok', [{ id: 'c1', message: 'Nice video!', settings: {} }], integration);
    expect(r[0].postId).toBe('comment-1');
    expect(r[0].releaseURL).toBe('https://peertube.example/w/vid-123');
  });

  it('customFields returns default instance URL', async () => {
    const fields = await provider.customFields();
    expect(fields).toHaveLength(3);
    const instanceField = fields.find(f => f.key === 'instance');
    expect(instanceField?.defaultValue).toBe('https://');
    expect(instanceField?.key).toBe('instance');
    expect(instanceField?.label).toBe('Instance URL');
    expect(instanceField?.type).toBe('text');
    const usernameField = fields.find(f => f.key === 'username');
    expect(usernameField?.key).toBe('username');
    expect(usernameField?.type).toBe('text');
    const passwordField = fields.find(f => f.key === 'password');
    expect(passwordField?.key).toBe('password');
    expect(passwordField?.type).toBe('password');
  });

  it('post without message uses fallback title and description', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: '123', account: { displayName: 'Test User', avatar: { path: '/avatar.jpg' } }, username: 'testuser', videoChannels: [{ id: 1 }] }) })
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(Buffer.from('vid')) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ video: { id: 'vid-123', uuid: 'abc-123' } }) });

    const r = await provider.post('123', 'tok', [{ id: 'p1', message: '', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }], integration);
    expect(r[0].postId).toBe('vid-123');
    expect(r[0].releaseURL).toBe('https://peertube.example/w/abc-123');
  });

  it('comment handles missing comment id in response', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });

    const r = await provider.comment('123', 'vid-123', undefined, 'tok', [{ id: 'c1', message: 'Nice video!', settings: {} }], integration);
    expect(r[0].postId).toBe('');
    expect(r[0].releaseURL).toBe('https://peertube.example/w/vid-123');
  });

  it('authenticate throws on missing access_token in login', async () => {
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' })).toString('base64');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });

    await expect(provider.authenticate({ code: base64Str, codeVerifier: 'none' })).rejects.toThrow('PeerTube login failed');
  });

  it('authenticate returns Invalid PeerTube credentials when me has no id', async () => {
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' })).toString('base64');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) });

    const r = await provider.authenticate({ code: base64Str, codeVerifier: 'none' });
    expect(r).toBe('Invalid PeerTube credentials');
  });

  it('authenticate falls back to username when account.displayName is missing', async () => {
    const base64Str = Buffer.from(JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' })).toString('base64');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: '123', username: 'testuser' }) });

    const r = await provider.authenticate({ code: base64Str, codeVerifier: 'none' });
    expect((r as any).name).toBe('testuser');
    expect((r as any).picture).toBe('');
  });

  it('post uses account.id fallback when videoChannels is missing', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: '123', account: { id: '456', displayName: 'Test', avatar: { path: '/av.jpg' } }, username: 'testuser' }) })
      .mockResolvedValueOnce({ blob: vi.fn().mockResolvedValue(Buffer.from('vid')) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ video: { id: 'vid-123', uuid: 'abc-123' } }) });

    const r = await provider.post('123', 'tok', [{ id: 'p1', message: 'Test', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }], integration);
    expect(r[0].postId).toBe('vid-123');
  });

  it('post throws No PeerTube channel found when both videoChannels and account are missing', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ client_id: 'cid', client_secret: 'csec' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'pt-tok' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ id: '123', username: 'testuser' }) });

    await expect(provider.post('123', 'tok', [{ id: 'p1', message: 'Test', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }], integration)).rejects.toThrow('No PeerTube channel found');
  });

  it('propagates RefreshTokenError on 401 from fetch', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValue(respError('Unauthorized', 401));

    await expect(provider.post('123', 'tok', [{ id: 'p1', message: 'Test', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }], integration)).rejects.toThrow(RefreshTokenError);
  });

  it('propagates BadBodyError on 400 from fetch', async () => {
    const integration = { id: 'int-1', customInstanceDetails: JSON.stringify({ instance: 'https://peertube.example', username: 'testuser', password: 'testpass' }) } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValue(respError('Bad Request', 400));

    await expect(provider.post('123', 'tok', [{ id: 'p1', message: 'Test', settings: {}, media: [{ path: 'https://ex.com/vid.mp4' }] }], integration)).rejects.toThrow(BadBodyError);
  });
});
