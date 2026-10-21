import { describe, it, expect } from 'vitest';
import dns from 'node:dns/promises';

// vitest.setup.ts replaces dns.lookup with a deterministic stub so unit tests never
// hit the network (a slow CI resolver timed out a media.service spec on the v1.3.0
// tag run). Pin the stub's contract so it can't silently regress to real DNS.
describe('unit-test DNS stub', () => {
  it('resolves dotted hosts to a fixed public address', async () => {
    await expect(dns.lookup('example.com')).resolves.toEqual({ address: '93.184.215.14', family: 4 });
    await expect(dns.lookup('cdn.example.com', { all: true })).resolves.toEqual([
      { address: '93.184.215.14', family: 4 },
    ]);
  });

  it('fails single-label hosts like a real resolver', async () => {
    await expect(dns.lookup('x')).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });

  it('maps localhost to loopback and returns IP literals as-is', async () => {
    await expect(dns.lookup('localhost')).resolves.toEqual({ address: '127.0.0.1', family: 4 });
    await expect(dns.lookup('10.0.0.5')).resolves.toEqual({ address: '10.0.0.5', family: 4 });
  });
});
