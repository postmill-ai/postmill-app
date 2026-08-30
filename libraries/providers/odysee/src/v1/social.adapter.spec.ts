import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Pass-through crypto so customInstanceDetails fixtures read as plain JSON.
vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: vi.fn((value: string) => `encrypted:${value}`),
    fixedDecryption: vi.fn((value: string) =>
      value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value
    ),
  },
}));

import { OdyseeProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

const safeFetchMock = vi.fn();
const undiciFetchMock = vi.fn();

class MockBadBodyError extends Error {
  constructor(...args: any[]) {
    super(args[3] ?? 'BadBody');
    this.name = 'BadBodyError';
  }
}
class MockRefreshTokenError extends Error {}

setSocialFetchPorts({
  safeFetch: safeFetchMock,
  undiciFetch: undiciFetchMock,
  ssrfSafeDispatcher: {},
  getVpnDispatcher: () => undefined,
  isSafePublicHttpsUrl: async () => true,
  RefreshTokenError: MockRefreshTokenError,
  BadBodyError: MockBadBodyError,
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

const rpcResult = (result: any) => jsonResponse({ jsonrpc: '2.0', id: 1, result });
const rpcError = (message: string) =>
  jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message } });

const encodeCallback = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

const lastRpcBody = (call = 0) => JSON.parse(undiciFetchMock.mock.calls[call][1].body);

describe('OdyseeProvider', () => {
  let provider: OdyseeProvider;
  let uploadDir: string;

  beforeEach(() => {
    provider = new OdyseeProvider();
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.postmill.example');
    uploadDir = mkdtempSync(path.join(tmpdir(), 'odysee-uploads-'));
    vi.stubEnv('UPLOAD_DIRECTORY', uploadDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('has its own channel identity and a direct, guidance-only descriptor', () => {
    expect(provider.identifier).toBe('odysee');
    expect(provider.name).toBe('Odysee');
    expect(provider.maxLength()).toBe(10000);
    expect(provider.setupDescriptor?.authType).toBe('direct');
    expect(provider.setupDescriptor?.credentialFields).toEqual([]);
    expect(provider.setupDescriptor?.setupSteps?.length).toBeGreaterThanOrEqual(3);
  });

  it('documents the shared-uploads and LBC limitations in the setup steps', () => {
    const steps = (provider.setupDescriptor?.setupSteps || []).join(' ');
    expect(steps).toContain('uploads directory');
    expect(steps).toContain('LBC');
    expect(steps).toContain('SSRF_ALLOWED_PRIVATE_CIDRS');
  });

  it('generateAuthUrl returns a state-based stub (customFields flow)', async () => {
    const { url, state } = await provider.generateAuthUrl();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toBe(state);
  });

  it('authenticates against the daemon and resolves the channel', async () => {
    undiciFetchMock
      .mockResolvedValueOnce(rpcResult({ is_running: true, installation_id: 'inst-1' }))
      .mockResolvedValueOnce(
        rpcResult({ items: [{ name: '@mychan', claim_id: 'claim-123' }] })
      );

    const result = await provider.authenticate({
      code: encodeCallback({ daemonUrl: 'http://localhost:5279', channelName: '@mychan' }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') throw new Error(`Expected object, got: ${result}`);
    expect(result.id).toBe('claim-123');
    expect(result.username).toBe('@mychan');
    expect(result.accessToken).toBe('http://localhost:5279');

    expect(undiciFetchMock.mock.calls[0][0]).toBe('http://localhost:5279');
    expect(lastRpcBody(0).method).toBe('status');
    expect(lastRpcBody(1).method).toBe('channel_list');
  });

  it('accepts a docker-service hostname over http (LAN-only rule)', async () => {
    undiciFetchMock.mockResolvedValueOnce(
      rpcResult({ is_running: true, installation_id: 'inst-1' })
    );
    const result = await provider.authenticate({
      code: encodeCallback({ daemonUrl: 'http://lbrynet:5279', channelName: '' }),
      codeVerifier: 'x',
    });
    if (typeof result === 'string') throw new Error(`Expected object, got: ${result}`);
    expect(result.id).toBe('inst-1');
  });

  it('rejects plain http for public hosts', async () => {
    const result = await provider.authenticate({
      code: encodeCallback({ daemonUrl: 'http://203.0.113.10:5279', channelName: '' }),
      codeVerifier: 'x',
    });
    expect(result).toBe(
      'Plain http is only allowed for loopback/LAN daemons — use https for a public endpoint'
    );
  });

  it('rejects non-http protocols and embedded credentials', async () => {
    expect(
      await provider.authenticate({
        code: encodeCallback({ daemonUrl: 'ftp://localhost:5279', channelName: '' }),
        codeVerifier: 'x',
      })
    ).toBe('Daemon URL must use http or https');

    expect(
      await provider.authenticate({
        code: encodeCallback({ daemonUrl: 'http://user:pass@localhost:5279', channelName: '' }),
        codeVerifier: 'x',
      })
    ).toBe('Daemon URL must not embed credentials');
  });

  it('returns a user-facing error when the daemon is unreachable', async () => {
    undiciFetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const result = await provider.authenticate({
      code: encodeCallback({ daemonUrl: 'http://localhost:5279', channelName: '' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('connect ECONNREFUSED');
  });

  it('returns a user-facing error when the channel is not in the daemon wallet', async () => {
    undiciFetchMock
      .mockResolvedValueOnce(rpcResult({ is_running: true, installation_id: 'inst-1' }))
      .mockResolvedValueOnce(rpcResult({ items: [] }));
    const result = await provider.authenticate({
      code: encodeCallback({ daemonUrl: 'http://localhost:5279', channelName: '@nope' }),
      codeVerifier: 'x',
    });
    expect(result).toContain('@nope');
    expect(result).toContain('not found');
  });

  it('publishes via stream_create with a local file and maps the release URL', async () => {
    mkdirSync(path.join(uploadDir, '2026/08'), { recursive: true });
    writeFileSync(path.join(uploadDir, '2026/08/vid.mp4'), 'fake-video');
    undiciFetchMock.mockResolvedValueOnce(
      rpcResult({
        txid: 'tx-1',
        outputs: [
          {
            type: 'claim',
            name: 'my-video-abc123',
            claim_id: 'claim-999',
            permanent_url: 'lbry://@mychan#c1c1/my-video-abc123#9999',
          },
        ],
      })
    );

    const integration = {
      customInstanceDetails:
        'encrypted:' +
        JSON.stringify({ daemonUrl: 'http://localhost:5279', channelName: '@mychan' }),
    } as any;

    const [res] = await provider.post('post-db-1', 'http://localhost:5279', [
      {
        id: 'post-db-1',
        message: 'My video\n\nLong description here',
        settings: {},
        media: [{ type: 'video', path: '2026/08/vid.mp4' }],
      },
    ], integration);

    expect(res.id).toBe('post-db-1');
    expect(res.postId).toBe('claim-999');
    expect(res.releaseURL).toBe('https://odysee.com/@mychan:c1c1/my-video-abc123:9999');
    expect(res.status).toBe('completed');

    const body = lastRpcBody(0);
    expect(body.method).toBe('stream_create');
    expect(body.params.file_path).toBe(path.join(uploadDir, '2026/08/vid.mp4'));
    expect(body.params.bid).toBe('0.001');
    expect(body.params.channel_name).toBe('@mychan');
    expect(body.params.title).toBe('My video');
    expect(body.params.description).toBe('My video\n\nLong description here');
    expect(body.params.name).toMatch(/^my-video-[0-9a-f]{6}$/);
  });

  it('stages remote (cloud-storage) media into the uploads dir and cleans up', async () => {
    safeFetchMock.mockResolvedValueOnce({
      blob: async () => new Blob(['remote-video-bytes']),
    } as any);
    undiciFetchMock.mockResolvedValueOnce(
      rpcResult({ txid: 'tx-1', outputs: [{ type: 'claim', name: 'x', claim_id: 'c1' }] })
    );

    const integration = {
      customInstanceDetails:
        'encrypted:' + JSON.stringify({ daemonUrl: 'http://localhost:5279', channelName: '' }),
    } as any;

    const [res] = await provider.post('post-db-2', 'http://localhost:5279', [
      {
        id: 'post-db-2',
        message: 'Remote video',
        settings: {},
        media: [{ type: 'video', path: 'https://cdn.example.com/media/vid.mp4' }],
      },
    ], integration);

    expect(res.postId).toBe('c1');
    expect(safeFetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/media/vid.mp4');
    const stagedPath = lastRpcBody(0).params.file_path;
    expect(stagedPath.startsWith(uploadDir + path.sep)).toBe(true);
    expect(stagedPath).toContain('odysee-stage-');
    // staged copy removed after publish
    expect(
      readdirSync(uploadDir).filter((f) => f.startsWith('odysee-stage-'))
    ).toEqual([]);
  });

  it('fails with a clear message when the media file is not on disk', async () => {
    const integration = {
      customInstanceDetails:
        'encrypted:' + JSON.stringify({ daemonUrl: 'http://localhost:5279', channelName: '' }),
    } as any;

    await expect(
      provider.post('post-db-3', 'http://localhost:5279', [
        {
          id: 'post-db-3',
          message: 'x',
          settings: {},
          media: [{ type: 'video', path: 'missing/file.mp4' }],
        },
      ], integration)
    ).rejects.toThrow(/uploads directory/);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('fails without media instead of creating an empty claim', async () => {
    const integration = {
      customInstanceDetails:
        'encrypted:' + JSON.stringify({ daemonUrl: 'http://localhost:5279', channelName: '' }),
    } as any;
    await expect(
      provider.post('post-db-4', 'http://localhost:5279', [
        { id: 'post-db-4', message: 'text only', settings: {}, media: [] },
      ], integration)
    ).rejects.toThrow(/one media file/);
  });

  it('surfaces JSON-RPC errors (e.g. insufficient LBC) as BadBody', async () => {
    mkdirSync(path.join(uploadDir, '2026/08'), { recursive: true });
    writeFileSync(path.join(uploadDir, '2026/08/vid.mp4'), 'fake-video');
    undiciFetchMock.mockResolvedValueOnce(
      rpcError('Not enough funds to cover the claim deposit')
    );

    const integration = {
      customInstanceDetails:
        'encrypted:' + JSON.stringify({ daemonUrl: 'http://localhost:5279', channelName: '' }),
    } as any;

    await expect(
      provider.post('post-db-5', 'http://localhost:5279', [
        {
          id: 'post-db-5',
          message: 'x',
          settings: {},
          media: [{ type: 'video', path: '2026/08/vid.mp4' }],
        },
      ], integration)
    ).rejects.toThrow(/Not enough funds/);
  });
});
