import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { readResponseCapped } from './capped-stream';

// Build a minimal Response-like object whose body is an async-iterable stream
// of the given chunks, plus an arrayBuffer() fallback.
function makeRes(chunks: Buffer[]) {
  const all = Buffer.concat(chunks);
  return {
    body: Readable.from(chunks),
    arrayBuffer: async () =>
      all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
  };
}

describe('readResponseCapped', () => {
  it('returns the full buffer when under the cap', async () => {
    const res = makeRes([Buffer.from('hello '), Buffer.from('world')]);
    const buf = await readResponseCapped(res, 1000);
    expect(buf.toString()).toBe('hello world');
  });

  it('aborts before buffering the whole body when the cap is exceeded', async () => {
    // 5 chunks of 100 bytes = 500 total; cap at 250 → must throw after ~3 chunks,
    // never reading all 500 bytes into one buffer.
    const chunks = Array.from({ length: 5 }, () => Buffer.alloc(100, 1));
    const res = makeRes(chunks);
    await expect(readResponseCapped(res, 250, 'too big')).rejects.toThrow(
      'too big',
    );
  });

  it('enforces the cap via arrayBuffer fallback when no stream body exists', async () => {
    const big = Buffer.alloc(500, 2);
    const res = {
      body: undefined,
      arrayBuffer: async () =>
        big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
    };
    await expect(readResponseCapped(res, 250, 'too big')).rejects.toThrow(
      'too big',
    );
  });

  it('boundary: exactly at the cap succeeds', async () => {
    const res = makeRes([Buffer.alloc(100, 3)]);
    const buf = await readResponseCapped(res, 100);
    expect(buf.length).toBe(100);
  });
});
