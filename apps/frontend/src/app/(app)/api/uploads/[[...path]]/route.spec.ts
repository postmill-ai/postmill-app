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

const ORIGINAL_UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY;

const callGet = (path?: string[]) =>
  GET({} as any, { params: Promise.resolve({ path }) });

describe('/api/uploads serve route containment (F8)', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uploads-root-'));
    outside = mkdtempSync(join(tmpdir(), 'uploads-outside-'));
    process.env.UPLOAD_DIRECTORY = root;
  });

  afterEach(() => {
    if (ORIGINAL_UPLOAD_DIRECTORY === undefined) {
      delete process.env.UPLOAD_DIRECTORY;
    } else {
      process.env.UPLOAD_DIRECTORY = ORIGINAL_UPLOAD_DIRECTORY;
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
    expect(await res.text()).toBe('hello world');
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
});
