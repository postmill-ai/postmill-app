import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { loadVisionImageBytes, resolveVisionImageUrl } from './vision-image-url';

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
