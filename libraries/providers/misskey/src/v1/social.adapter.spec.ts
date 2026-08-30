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

import { MisskeyProvider } from './social.adapter';
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
  instanceUrl: 'https://msk.example',
};

describe('MisskeyProvider identity', () => {
  const provider = new MisskeyProvider();

  it('has its own channel identity', () => {
    expect(provider.identifier).toBe('misskey');
    expect(provider.name).toBe('Misskey');
    expect(provider.maxLength()).toBe(3000);
    expect(provider.editor).toBe('normal');
    expect(provider.scopes).toEqual([
      'write:notes',
      'write:drive',
      'read:account',
    ]);
    expect(provider.commentsCapabilities).toEqual({
      read: true,
      reply: true,
      like: false,
    });
  });

  it('declares a direct (MiAuth) setup descriptor', () => {
    expect(provider.setupDescriptor?.authType).toBe('direct');
    expect(provider.setupDescriptor?.credentialFields).toEqual([]);
    expect(provider.setupDescriptor?.portalUrl).toBe(
      'https://misskey-hub.net/servers/'
    );
  });
});

describe('MisskeyProvider MiAuth session flow', () => {
  let provider: MisskeyProvider;

  beforeEach(() => {
    provider = new MisskeyProvider();
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.postmill.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('externalUrl verifies the host speaks the Misskey API via safeFetch', async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ version: '2025.1.0' }));

    const result = await provider.externalUrl('Msk.Example/');

    expect(result).toEqual({ client_id: '', client_secret: '' });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe('https://msk.example/api/meta');
    expect(init.method).toBe('POST');
  });

  it('externalUrl rejects a host that is not a Misskey-family server', async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({}));

    await expect(
      provider.externalUrl('https://msk.example')
    ).rejects.toThrow(/does not look like/);
  });

  it('externalUrl rejects invalid instance URLs before any outbound call', async () => {
    await expect(
      provider.externalUrl('http://msk.example')
    ).rejects.toThrow();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('generateAuthUrl builds a MiAuth URL with a makeOauthState session and misskey-scoped callback', async () => {
    const { url, state } = await provider.generateAuthUrl(clientInfo);

    // makeOauthState(): 128-bit CSPRNG as 32 hex chars — the MiAuth session id
    // is an arbitrary unique string, and the grep-guard pins makeOauthState().
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toContain(`https://msk.example/miauth/${state}`);
    expect(url).toContain(
      `callback=${encodeURIComponent(
        'https://app.postmill.example/integrations/social/misskey'
      )}`
    );
    expect(url).toContain('permission=write:notes,write:drive,read:account');
  });

  it('authenticate exchanges the session UUID for a token via the check endpoint', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        token: 'user-token',
        user: {
          id: 'u1',
          name: 'Alice',
          username: 'alice',
          avatarUrl: 'https://msk.example/avatar.png',
        },
      })
    );

    const auth = await provider.authenticate(
      { code: 'session-uuid', codeVerifier: 'x' },
      clientInfo
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://msk.example/api/miauth/session-uuid/check',
      expect.objectContaining({ method: 'POST' })
    );
    expect(auth).toMatchObject({
      id: 'u1',
      name: 'Alice',
      accessToken: 'user-token',
      username: 'alice',
      picture: 'https://msk.example/avatar.png',
    });
  });

  it('authenticate returns an error string when authorization was denied', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({ ok: false }));

    const auth = await provider.authenticate(
      { code: 'session-uuid', codeVerifier: 'x' },
      clientInfo
    );

    expect(typeof auth).toBe('string');
  });
});

describe('MisskeyProvider posting', () => {
  let provider: MisskeyProvider;

  beforeEach(() => {
    provider = new MisskeyProvider();
    vi.clearAllMocks();
  });

  it('uploads media to the drive (multipart, `i` field) then creates the note', async () => {
    safeFetchMock.mockResolvedValue({
      blob: async () => new Blob(['img']),
    });
    undiciFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1' })) // drive/files/create
      .mockResolvedValueOnce(
        jsonResponse({ createdNote: { id: 'note-1' } }) // notes/create
      );

    const result = await provider.post(
      'acct-1',
      'token-1',
      [
        {
          id: 'p1',
          message: 'hello misskey',
          settings: {},
          media: [{ type: 'image', path: 'https://cdn.example/x.png', alt: 'an image' }],
        },
      ] as any,
      {} as any,
      clientInfo
    );

    // Drive upload: the adapter passes a multipart FormData with the token as
    // the `i` field + alt comment; the kernel egress serializes it to a real
    // multipart body, so assert on the encoded buffer.
    const [driveUrl, driveInit] = undiciFetchMock.mock.calls[0];
    expect(driveUrl).toBe('https://msk.example/api/drive/files/create');
    expect(driveInit.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=/
    );
    const multipart = String(driveInit.body);
    expect(multipart).toContain('name="i"');
    expect(multipart).toContain('token-1');
    expect(multipart).toContain('name="comment"');
    expect(multipart).toContain('an image');
    expect(multipart).toContain('name="file"');

    // Note create: JSON body with the uploaded drive file id.
    const [noteUrl, noteInit] = undiciFetchMock.mock.calls[1];
    expect(noteUrl).toBe('https://msk.example/api/notes/create');
    const body = JSON.parse(noteInit.body);
    expect(body).toEqual({
      i: 'token-1',
      text: 'hello misskey',
      visibility: 'public',
      fileIds: ['file-1'],
    });

    expect(result[0]).toMatchObject({
      id: 'p1',
      postId: 'note-1',
      releaseURL: 'https://msk.example/notes/note-1',
      status: 'completed',
    });
  });

  it('posts to the instance stored (encrypted) on the integration', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ createdNote: { id: 'note-2' } })
    );
    const integration = {
      customInstanceDetails: `encrypted:${JSON.stringify({
        client_id: '',
        client_secret: '',
        instanceUrl: 'https://other.example',
      })}`,
    } as any;

    const result = await provider.post(
      'acct-1',
      'token-1',
      [{ id: 'p1', message: 'hi', settings: {}, media: [] }] as any,
      integration,
      clientInfo
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://other.example/api/notes/create',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result[0].releaseURL).toBe('https://other.example/notes/note-2');
  });

  it('comments via notes/create with replyId', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ createdNote: { id: 'note-3' } })
    );

    const result = await provider.comment(
      'acct-1',
      'note-1',
      undefined,
      'token-1',
      [{ id: 'c1', message: 'a reply', settings: {}, media: [] }] as any,
      {} as any,
      clientInfo
    );

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://msk.example/api/notes/create');
    expect(JSON.parse(init.body)).toMatchObject({
      text: 'a reply',
      replyId: 'note-1',
    });
    expect(result[0].postId).toBe('note-3');
  });
});

describe('MisskeyProvider comments + analytics mapping', () => {
  let provider: MisskeyProvider;

  beforeEach(() => {
    provider = new MisskeyProvider();
    vi.clearAllMocks();
  });

  it('fetchComments maps notes/children, summing the reactions map', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse([
        {
          id: 'c1',
          replyId: 'n1',
          user: {
            id: 'u1',
            name: 'Alice',
            username: 'alice',
            avatarUrl: 'a.png',
            host: 'remote.example',
          },
          text: 'nice note',
          createdAt: '2026-01-01T00:00:00.000Z',
          reactions: { '❤': 2, '👍': 1 },
          repliesCount: 3,
          myReaction: '❤',
        },
      ])
    );

    const { comments } = await provider.fetchComments(
      'acct-1',
      'token-1',
      'n1',
      undefined,
      {} as any,
      clientInfo
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://msk.example/api/notes/children',
      expect.objectContaining({ method: 'POST' })
    );
    expect(comments[0]).toMatchObject({
      platformCommentId: 'c1',
      parentPlatformCommentId: 'n1',
      content: 'nice note',
      likeCount: 3,
      replyCount: 3,
      likedByMe: true,
    });
    expect(comments[0].author.username).toBe('@alice@remote.example');
  });

  it('analytics maps users/show followersCount', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({ followersCount: 42 }));

    const result = await provider.analytics('u1', 'token-1', 0, clientInfo);

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://msk.example/api/users/show',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual([
      {
        label: 'Followers',
        data: [{ total: '42', date: expect.any(String) }],
      },
    ]);
  });

  it('postAnalytics maps notes/show reactions/renotes/replies', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({
        reactions: { '❤': 3, '👍': 2 },
        renoteCount: 4,
        repliesCount: 1,
      })
    );

    const result = await provider.postAnalytics(
      'int-1',
      'token-1',
      'n1',
      0,
      clientInfo
    );

    const labels = Object.fromEntries(
      result.map((r) => [r.label, r.data[0].total])
    );
    expect(labels).toEqual({
      Reactions: '5',
      Renotes: '4',
      Replies: '1',
    });
  });
});

describe('MisskeyProvider error mapping', () => {
  const provider = new MisskeyProvider();
  const err = (code: string, message: string) =>
    JSON.stringify({ error: { message, code, id: 'x' } });

  it('maps credential errors to refresh-token', () => {
    expect(
      provider.handleErrors(err('CREDENTIALS_REQUIRED', 'Credential required.'), 401)
    ).toEqual({ type: 'refresh-token', value: 'Credential required.' });
    expect(
      provider.handleErrors(err('AUTHENTICATION_FAILED', 'Failed.'), 401)?.type
    ).toBe('refresh-token');
    expect(
      provider.handleErrors(err('PERMISSION_DENIED', 'No permission.'), 403)?.type
    ).toBe('refresh-token');
  });

  it('maps rate limits to retry', () => {
    expect(
      provider.handleErrors(err('RATE_LIMIT_EXCEEDED', 'Slow down.'), 429)
    ).toEqual({ type: 'retry', value: 'Slow down.' });
  });

  it('maps other Misskey errors to bad-body with the server message', () => {
    expect(
      provider.handleErrors(err('NO_SUCH_NOTE', 'No such note.'), 400)
    ).toEqual({ type: 'bad-body', value: 'NO_SUCH_NOTE: No such note.' });
  });

  it('returns undefined for non-Misskey error bodies', () => {
    expect(provider.handleErrors('<html>proxy error</html>', 502)).toBeUndefined();
  });

  it('checkValidity enforces the 16-attachment note limit', async () => {
    const seventeen = Array.from({ length: 17 }, (_, i) => ({
      path: `https://cdn.example/${i}.png`,
    }));
    expect(await provider.checkValidity([seventeen] as any)).toMatch(
      /16 attachments/
    );
    expect(await provider.checkValidity([seventeen.slice(0, 16)] as any)).toBe(
      true
    );
  });
});
