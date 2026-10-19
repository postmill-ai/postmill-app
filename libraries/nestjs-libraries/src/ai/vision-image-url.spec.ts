import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import dns from 'node:dns/promises';
import { loadVisionImageBytes, resolveVisionImageUrl } from './vision-image-url';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}));

const mockPublicDns = () =>
  vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
const mockPrivateDns = () =>
  vi.mocked(dns.lookup).mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);

/**
 * The AI Designer's contact sheet rides memory as a `data:` URI instead of
 * being persisted to storage on every save — the resolver must pass it
 * through (it is already inline, so there is nothing to fetch or read)
 * subject only to the prompt-size cap.
 */
describe('resolveVisionImageUrl data URIs', () => {
  it('passes an image data URI through unchanged', async () => {
    const uri = `data:image/png;base64,${Buffer.from('sheet').toString('base64')}`;
    await expect(resolveVisionImageUrl(uri)).resolves.toBe(uri);
  });

  it('refuses an inlined image over the byte cap', async () => {
    const warn = vi.fn();
    const uri = `data:image/png;base64,${Buffer.alloc(1024).toString('base64')}`;
    await expect(
      resolveVisionImageUrl(uri, { warn, maxInlineBytes: 512 })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('still rejects a non-image data URI', async () => {
    await expect(
      resolveVisionImageUrl('data:text/html;base64,PGI+')
    ).resolves.toBeNull();
  });
});

/**
 * The raw-bytes loader behind the vision critic's downscale recovery: an
 * image the resolver refuses FOR SIZE can still be read and shrunk instead of
 * skipping the review. Only in-hand sources are readable — never a fetch.
 */
describe('loadVisionImageBytes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `vision-image-url-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    vi.stubEnv('UPLOAD_DIRECTORY', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  it('decodes a data URI regardless of the inline cap', async () => {
    const payload = Buffer.from('oversized-sheet');
    const uri = `data:image/png;base64,${payload.toString('base64')}`;
    await expect(loadVisionImageBytes(uri)).resolves.toEqual(payload);
  });

  it('reads a local upload off disk', async () => {
    const payload = Buffer.from('local-bytes');
    writeFileSync(path.join(tmpDir, 'sheet.png'), payload);
    await expect(
      loadVisionImageBytes('http://localhost:4200/uploads/sheet.png')
    ).resolves.toEqual(payload);
  });

  it('returns null (and warns) for a missing local file', async () => {
    const warn = vi.fn();
    await expect(
      loadVisionImageBytes('http://localhost:4200/uploads/missing.png', {
        warn,
      })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('refuses a traversal outside the upload root', async () => {
    await expect(
      loadVisionImageBytes('/uploads/..%2F..%2Fetc%2Fpasswd')
    ).resolves.toBeNull();
  });

  it('refuses a symlink inside the root that points outside it', async () => {
    // `path.resolve` does not follow links, so prefix containment alone would
    // have read the target happily — and vision inlines what it reads into a
    // prompt bound for a third-party model. `/uploads/*` is served through the
    // same ladder (resolve → prefix → stat → realpath); this path now matches.
    const secret = path.join(os.tmpdir(), `vision-secret-${Date.now()}.png`);
    writeFileSync(secret, Buffer.from('not-yours'));
    symlinkSync(secret, path.join(tmpDir, 'planted.png'));
    const warn = vi.fn();
    await expect(
      loadVisionImageBytes('http://localhost:4200/uploads/planted.png', { warn })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    rmSync(secret, { force: true });
  });

  it('refuses a directory, which is not a readable upload', async () => {
    mkdirSync(path.join(tmpDir, 'a-folder'));
    await expect(
      loadVisionImageBytes('http://localhost:4200/uploads/a-folder')
    ).resolves.toBeNull();
  });

  it('refuses a rooted or NUL-spliced key, not only a `..` that escapes', async () => {
    // Shape is rejected before the path is resolved: an upload key is always a
    // relative storage key, so these never reach the filesystem at all.
    for (const key of ['%2Fetc%2Fpasswd', 'a%00.png', '..%2F..']) {
      await expect(loadVisionImageBytes(`/uploads/${key}`)).resolves.toBeNull();
    }
  });

  it('never fetches a remote URL — returns null', async () => {
    await expect(
      loadVisionImageBytes('https://example.com/sheet.png')
    ).resolves.toBeNull();
  });
});

/**
 * `preferPublicUrl` — the image-edit path (bg-remove/inpaint/outpaint via
 * Replicate): those models validate inputs as strict http(s) URLs and reject
 * data: URIs, so a genuinely public upload URL must pass through unchanged,
 * while a private host still falls back to inlining.
 */
describe('resolveVisionImageUrl preferPublicUrl', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `vision-prefer-public-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.stubEnv('UPLOAD_DIRECTORY', tmpDir);
    vi.stubEnv('SSRF_ALLOWED_PRIVATE_CIDRS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(dns.lookup).mockReset();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  it('passes a publicly reachable local-upload URL through instead of inlining', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://app.example.com');
    mockPublicDns();
    writeFileSync(path.join(tmpDir, 'sheet.png'), Buffer.from('local-bytes'));
    await expect(
      resolveVisionImageUrl('https://app.example.com/uploads/sheet.png', {
        preferPublicUrl: true,
      })
    ).resolves.toBe('https://app.example.com/uploads/sheet.png');
  });

  it('still inlines when the host resolves to a private address (provider cannot reach it)', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://intranet.example.com');
    mockPrivateDns();
    writeFileSync(path.join(tmpDir, 'sheet.png'), Buffer.from('local-bytes'));
    const resolved = await resolveVisionImageUrl(
      'https://intranet.example.com/uploads/sheet.png',
      { preferPublicUrl: true }
    );
    expect(resolved).toMatch(/^data:image\//);
  });

  it('ignores SSRF_ALLOWED_PRIVATE_CIDRS — the opt-in never applies to the provider network', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://intranet.example.com');
    vi.stubEnv('SSRF_ALLOWED_PRIVATE_CIDRS', '10.0.0.0/8');
    mockPrivateDns();
    writeFileSync(path.join(tmpDir, 'sheet.png'), Buffer.from('local-bytes'));
    const resolved = await resolveVisionImageUrl(
      'https://intranet.example.com/uploads/sheet.png',
      { preferPublicUrl: true }
    );
    expect(resolved).toMatch(/^data:image\//);
  });

  it('passes a public non-local URL through as before', async () => {
    mockPublicDns();
    await expect(
      resolveVisionImageUrl('https://cdn.example.com/sheet.png', {
        preferPublicUrl: true,
      })
    ).resolves.toBe('https://cdn.example.com/sheet.png');
  });

  it('without preferPublicUrl a public local-upload URL keeps inlining (vision default)', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://app.example.com');
    mockPublicDns();
    writeFileSync(path.join(tmpDir, 'sheet.png'), Buffer.from('local-bytes'));
    const resolved = await resolveVisionImageUrl(
      'https://app.example.com/uploads/sheet.png'
    );
    expect(resolved).toMatch(/^data:image\//);
  });
});
