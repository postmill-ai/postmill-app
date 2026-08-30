import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pass-through crypto so customInstanceDetails fixtures read as plain JSON.
vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: vi.fn((value: string) => `encrypted:${value}`),
    fixedDecryption: vi.fn((value: string) =>
      value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value
    ),
  },
}));

import { SharkeyProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

const safeFetchMock = vi.fn();
const undiciFetchMock = vi.fn();

// All instance HTTP must travel via the kernel ports (SSRF-hardened) — these
// tests inject mocked ports and assert they are the ones being called.
setSocialFetchPorts({
  safeFetch: safeFetchMock,
  undiciFetch: undiciFetchMock,
  ssrfSafeDispatcher: {},
  getVpnDispatcher: () => undefined,
  isSafePublicHttpsUrl: async () => true,
  RefreshTokenError: class extends Error {},
  BadBodyError: class extends Error {},
  timer: async () => undefined,
  sharp: vi.fn(),
  readOrFetch: async () => Buffer.from(''),
} as any);

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

const clientInfo = {
  client_id: '',
  client_secret: '',
  instanceUrl: 'https://shark.example',
};

describe('SharkeyProvider (Misskey-API family subclass)', () => {
  let provider: SharkeyProvider;

  beforeEach(() => {
    provider = new SharkeyProvider();
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.postmill.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has its own channel identity on the shared Misskey base', () => {
    expect(provider.identifier).toBe('sharkey');
    expect(provider.name).toBe('Sharkey');
    expect(provider.maxLength()).toBe(3000);
    expect(provider.scopes).toEqual([
      'write:notes',
      'write:drive',
      'read:account',
    ]);
  });

  it('declares a direct (MiAuth) setup descriptor with the Sharkey instance list', () => {
    expect(provider.setupDescriptor?.authType).toBe('direct');
    expect(provider.setupDescriptor?.credentialFields).toEqual([]);
    expect(provider.setupDescriptor?.portalUrl).toBe(
      'https://joinsharkey.org/instances/'
    );
  });

  it('externalUrl verifies the host speaks the Misskey API via safeFetch', async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ version: '2025.2.0-shark' }));

    const result = await provider.externalUrl('Shark.Example');

    expect(result).toEqual({ client_id: '', client_secret: '' });
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe('https://shark.example/api/meta');
    expect(init.method).toBe('POST');
  });

  it('builds the MiAuth URL with a sharkey-scoped callback', async () => {
    const { url, state } = await provider.generateAuthUrl(clientInfo);

    expect(url).toContain(`https://shark.example/miauth/${state}`);
    expect(url).toContain(
      `callback=${encodeURIComponent(
        'https://app.postmill.example/integrations/social/sharkey'
      )}`
    );
    expect(url).toContain('permission=write:notes,write:drive,read:account');
  });

  it('authenticate exchanges the session UUID via the check endpoint', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        token: 'shark-token',
        user: { id: 'u9', name: null, username: 'fin', avatarUrl: null },
      })
    );

    const auth = await provider.authenticate(
      { code: 'session-uuid', codeVerifier: 'x' },
      clientInfo
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://shark.example/api/miauth/session-uuid/check',
      expect.objectContaining({ method: 'POST' })
    );
    // Null display name falls back to the username.
    expect(auth).toMatchObject({
      id: 'u9',
      name: 'fin',
      accessToken: 'shark-token',
      username: 'fin',
    });
  });

  it('posts with media to the instance stored (encrypted) on the integration', async () => {
    safeFetchMock.mockResolvedValue({
      blob: async () => new Blob(['img']),
    });
    undiciFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1' })) // drive/files/create
      .mockResolvedValueOnce(
        jsonResponse({ createdNote: { id: 'note-1' } }) // notes/create
      );
    const integration = {
      customInstanceDetails: `encrypted:${JSON.stringify({
        client_id: '',
        client_secret: '',
        instanceUrl: 'https://reef.example',
      })}`,
    } as any;

    const result = await provider.post(
      'acct-1',
      'token-1',
      [
        {
          id: 'p1',
          message: 'hello sharkey',
          settings: {},
          media: [{ type: 'image', path: 'https://cdn.example/x.png' }],
        },
      ] as any,
      integration,
      clientInfo
    );

    const [driveUrl] = undiciFetchMock.mock.calls[0];
    expect(driveUrl).toBe('https://reef.example/api/drive/files/create');
    const [noteUrl, noteInit] = undiciFetchMock.mock.calls[1];
    expect(noteUrl).toBe('https://reef.example/api/notes/create');
    expect(JSON.parse(noteInit.body)).toMatchObject({
      text: 'hello sharkey',
      visibility: 'public',
      fileIds: ['file-1'],
    });
    expect(result[0].releaseURL).toBe('https://reef.example/notes/note-1');
  });

  it('maps Misskey error JSON to the repo conventions', () => {
    const body = JSON.stringify({
      error: { message: 'Credential required.', code: 'CREDENTIALS_REQUIRED' },
    });
    expect(provider.handleErrors(body, 401)).toEqual({
      type: 'refresh-token',
      value: 'Credential required.',
    });
  });
});
