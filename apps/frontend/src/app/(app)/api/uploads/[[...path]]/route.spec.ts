import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The handler is invoked directly with crafted `params.path`: a router-level
// request can't demonstrate the traversal because WHATWG URL normalization
// collapses dot segments (literal and %2e-encoded) before routing (F8 [H3]).
import { GET } from './route';

const STORAGE_ENV_KEYS = [
  'UPLOAD_DIRECTORY',
  'STORAGE_PROVIDER',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_PUBLIC_URL',
];
const ORIGINAL_STORAGE_ENV = Object.fromEntries(
  STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const callGet = (path?: string[], range?: string, search = '') =>
  GET(
    {
      headers: new Headers(range ? { Range: range } : {}),
      nextUrl: { search },
    } as any,
    { params: Promise.resolve({ path }) },
  );

describe('/api/uploads serve route containment (F8)', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uploads-root-'));
    outside = mkdtempSync(join(tmpdir(), 'uploads-outside-'));
    process.env.UPLOAD_DIRECTORY = root;
    process.env.STORAGE_PROVIDER = 'local';
  });

  afterEach(() => {
    for (const key of STORAGE_ENV_KEYS) {
      const value = ORIGINAL_STORAGE_ENV[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('serves a legitimately stored file (200 + immutable cache headers)', async () => {
    writeFileSync(join(root, 'hello.txt'), 'hello world');

    const res = await callGet(['hello.txt']);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.headers.get('Content-Length')).toBe('11');
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    // Cross-origin anonymous reads: the video-render frame page draws these
    // files to canvas from the api origin (crossOrigin='anonymous').
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.text()).toBe('hello world');
  });

  it('advertises byte ranges and serves a bounded single range as 206', async () => {
    writeFileSync(join(root, 'clip.mp4'), Buffer.from('0123456789'));

    const res = await callGet(['clip.mp4'], 'bytes=2-5');

    expect(res.status).toBe(206);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(res.headers.get('Content-Length')).toBe('4');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Last-Modified')).not.toBeNull();
    expect(await res.arrayBuffer()).toEqual(Buffer.from('2345').buffer);
  });

  it('serves an open-ended range through EOF', async () => {
    writeFileSync(join(root, 'hello.txt'), 'hello world');

    const res = await callGet(['hello.txt'], 'bytes=6-');

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 6-10/11');
    expect(res.headers.get('Content-Length')).toBe('5');
    expect(await res.text()).toBe('world');
  });

  it('clamps a range end beyond EOF', async () => {
    writeFileSync(join(root, 'hello.txt'), 'hello world');

    const res = await callGet(['hello.txt'], 'bytes=8-100');

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 8-10/11');
    expect(await res.text()).toBe('rld');
  });

  it.each(['bytes=11-', 'bytes=50-10'])(
    'returns 416 with the full size for unsatisfiable range %s',
    async (range) => {
      writeFileSync(join(root, 'hello.txt'), 'hello world');

      const res = await callGet(['hello.txt'], range);

      expect(res.status).toBe(416);
      expect(res.headers.get('Content-Range')).toBe('bytes */11');
      expect(res.headers.get('Content-Length')).toBe('0');
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(await res.text()).toBe('');
    },
  );

  it.each([
    'bytes=-5',
    'bytes=0-1,5-6',
    'items=0-1',
    'bytes=abc-def',
  ])('retains the full 200 response for unsupported range %s', async (range) => {
    writeFileSync(join(root, 'hello.txt'), 'hello world');

    const res = await callGet(['hello.txt'], range);

    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Range')).toBeNull();
    expect(res.headers.get('Content-Length')).toBe('11');
    expect(await res.text()).toBe('hello world');
  });

  it('serves an empty file and rejects every explicit range for it', async () => {
    writeFileSync(join(root, 'empty.bin'), '');

    const full = await callGet(['empty.bin']);
    const partial = await callGet(['empty.bin'], 'bytes=0-');

    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Length')).toBe('0');
    expect(await full.text()).toBe('');
    expect(partial.status).toBe(416);
    expect(partial.headers.get('Content-Range')).toBe('bytes */0');
  });

  it('rejects dot-segment traversal that escapes the root (404)', async () => {
    const res = await callGet(['..', '..', 'etc', 'passwd']);

    expect(res.status).toBe(404);
  });

  it('rejects a missing file inside the root (ENOENT → 404)', async () => {
    const res = await callGet(['no-such-file.txt']);

    expect(res.status).toBe(404);
  });

  it('rejects a directory inside the root (404, not EISDIR)', async () => {
    mkdirSync(join(root, 'subdir'));

    const res = await callGet(['subdir']);

    expect(res.status).toBe(404);
  });

  it('fails closed when UPLOAD_DIRECTORY is unset (404)', async () => {
    delete process.env.UPLOAD_DIRECTORY;

    const res = await callGet(['hello.txt']);

    expect(res.status).toBe(404);
  });

  it('rejects a symlink inside the root pointing outside it (404)', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'top secret');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));

    const res = await callGet(['link.txt']);

    expect(res.status).toBe(404);
  });

  describe('S3 platform mode', () => {
    beforeEach(() => {
      for (const key of STORAGE_ENV_KEYS) {
        if (key !== 'UPLOAD_DIRECTORY') delete process.env[key];
      }
      Object.assign(process.env, {
        STORAGE_PROVIDER: 's3',
        S3_PUBLIC_URL: 'https://postmill.fsn1.your-objectstorage.com/',
      });
    });

    it('redirects the unchanged legacy key without requiring S3 credentials or reading disk', async () => {
      const res = await callGet(
        ['org-1', '2026', '11', '07', 'my file.png'],
        undefined,
        '?version=2',
      );

      expect(res.status).toBe(307);
      expect(res.headers.get('Location')).toBe(
        'https://postmill.fsn1.your-objectstorage.com/org-1/2026/11/07/my%20file.png?version=2',
      );
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('rejects traversal rather than redirecting it', async () => {
      const res = await callGet(['org-1', '..', 'org-2', 'secret.png']);
      expect(res.status).toBe(404);
      expect(res.headers.get('Location')).toBeNull();
    });

    it('fails closed when the public URL is missing', async () => {
      delete process.env.S3_PUBLIC_URL;
      const res = await callGet(['org-1', 'image.png']);
      expect(res.status).toBe(404);
    });

    it('fails closed when the public URL is invalid', async () => {
      process.env.S3_PUBLIC_URL = 'file:///tmp/bucket';
      const res = await callGet(['org-1', 'image.png']);
      expect(res.status).toBe(404);
    });

    it('returns to local serving when the operator rolls back', async () => {
      writeFileSync(join(root, 'rollback.txt'), 'local copy');
      process.env.STORAGE_PROVIDER = 'local';

      const res = await callGet(['rollback.txt']);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('local copy');
    });
  });
});
