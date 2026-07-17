import { describe, it, expect } from 'vitest';
import {
  validateModelId,
  redactError,
  isTransientStatus,
  readCappedArrayBuffer,
} from './media-guards';

describe('validateModelId', () => {
  it('accepts owner/name slugs, hashes and dotted versions', () => {
    expect(validateModelId('black-forest-labs/flux-schnell')).toBe('black-forest-labs/flux-schnell');
    expect(validateModelId('fal-ai/kling-video/v1.6/standard')).toBe('fal-ai/kling-video/v1.6/standard');
    expect(validateModelId('gpt-image-1')).toBe('gpt-image-1');
  });

  it('rejects path traversal, query, fragment and whitespace injection', () => {
    expect(() => validateModelId('../../etc/passwd')).toThrow();
    expect(() => validateModelId('flux?callback=https://evil.com')).toThrow();
    expect(() => validateModelId('flux#frag')).toThrow();
    expect(() => validateModelId('flux schnell')).toThrow();
    expect(() => validateModelId('')).toThrow();
  });
});

describe('redactError', () => {
  it('truncates to 500 chars', () => {
    const long = 'x'.repeat(2000);
    expect(redactError(long).length).toBe(500);
  });

  it('redacts signed-token query params', () => {
    const body = 'failed https://bucket.s3.amazonaws.com/o?X-Amz-Signature=abc123&token=zzz';
    const out = redactError(body);
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('zzz');
    expect(out).toContain('[REDACTED]');
  });

  it('tolerates empty/undefined bodies', () => {
    expect(redactError('')).toBe('');
    expect(redactError(undefined as unknown as string)).toBe('');
  });
});

describe('isTransientStatus', () => {
  it('flags 429 and 5xx as transient, not 4xx', () => {
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(200)).toBe(false);
  });
});

describe('readCappedArrayBuffer', () => {
  const mkRes = (bytes: number, declared?: number) => ({
    headers: { get: (n: string) => (n === 'content-length' && declared != null ? String(declared) : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  });

  it('rejects on a declared content-length over the cap', async () => {
    await expect(readCappedArrayBuffer(mkRes(10, 1000), 100)).rejects.toThrow(/too large/);
  });

  it('rejects when the streamed/buffered body exceeds the cap', async () => {
    await expect(readCappedArrayBuffer(mkRes(200), 100)).rejects.toThrow(/exceeded cap/);
  });

  it('returns a Buffer under the cap', async () => {
    const buf = await readCappedArrayBuffer(mkRes(50), 100);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(50);
  });
});
