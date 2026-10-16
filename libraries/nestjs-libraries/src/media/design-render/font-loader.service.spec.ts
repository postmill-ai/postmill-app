import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { FontLoaderService, boundedCacheSet, safeFileId } from './font-loader.service';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { registerFont } from 'canvas';

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: vi.fn(),
}));

vi.mock('canvas', () => ({
  registerFont: vi.fn(),
}));

const safeFetchMock = safeFetch as ReturnType<typeof vi.fn>;
const registerFontMock = registerFont as ReturnType<typeof vi.fn>;

describe('safeFileId (6.4 font-loader temp filename sanitize)', () => {
  it('strips path separators and traversal sequences from a fileId', () => {
    expect(safeFileId('../../etc/passwd')).toBe('______etc_passwd');
    expect(safeFileId('a/b/c')).toBe('a_b_c');
    expect(safeFileId('x\\y')).toBe('x_y');
    expect(safeFileId('a b.ttf')).toBe('a_b_ttf');
  });

  it('leaves already-safe ids intact', () => {
    expect(safeFileId('file_123-ABC')).toBe('file_123-ABC');
  });
});

describe('boundedCacheSet', () => {
  it('evicts the oldest entries past the cap', () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 5; i++) boundedCacheSet(map, `k${i}`, i, 3);
    expect([...map.keys()]).toEqual(['k2', 'k3', 'k4']);
  });

  it('refreshes recency on re-insert instead of duplicating', () => {
    const map = new Map<string, number>();
    boundedCacheSet(map, 'a', 1, 2);
    boundedCacheSet(map, 'b', 2, 2);
    boundedCacheSet(map, 'a', 3, 2); // refresh: b is now oldest
    boundedCacheSet(map, 'c', 4, 2);
    expect([...map.keys()]).toEqual(['a', 'c']);
    expect(map.get('a')).toBe(3);
  });
});

describe('curated font failure retry window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    safeFetchMock.mockReset();
    safeFetchMock.mockResolvedValue({ ok: false, status: 500 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeService = () =>
    new FontLoaderService({
      getCustomFonts: vi.fn().mockResolvedValue([]),
    } as any);

  it('does not refetch a failed family within the retry window', async () => {
    const service = makeService();
    const elements = [{ fontFamily: 'Inter', fontWeight: 400 }];

    await service.loadCuratedFonts(elements);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);

    await service.loadCuratedFonts(elements);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed family after the retry window instead of blacklisting forever', async () => {
    const service = makeService();
    const elements = [{ fontFamily: 'Inter', fontWeight: 400 }];

    await service.loadCuratedFonts(elements);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(16 * 60_000);

    await service.loadCuratedFonts(elements);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('loadOrgFonts multi-weight registration', () => {
  const fontResponse = () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([0, 1, 2, 3]).buffer,
  });

  const makeService = (fonts: any[], forOrg = 'org1') =>
    new FontLoaderService({
      // Scoped like the real repository: another org's lookup must come back empty.
      getCustomFonts: vi.fn(async (orgId: string) => (orgId === forOrg ? fonts : [])),
    } as any);

  beforeEach(() => {
    safeFetchMock.mockReset();
    safeFetchMock.mockImplementation(async () => fontResponse());
    registerFontMock.mockClear();
  });

  it('registers every uploaded weight of a family, not just the first', async () => {
    const service = makeService([
      {
        family: 'Acme Sans',
        fileId: 'f1',
        path: 'https://cdn.example.com/acme.ttf',
        weights: [400, 700],
      },
    ]);

    await service.loadOrgFonts('org1');

    const registered = registerFontMock.mock.calls.map(
      ([, opts]: [string, { family: string; weight: string }]) => opts
    );
    expect(registered).toEqual([
      { family: 'Acme Sans', weight: '400' },
      { family: 'Acme Sans', weight: '700' },
    ]);
    // One download, two registrations — the extra weight aliases the same file.
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to weight 400 when the upload carries no weights', async () => {
    const service = makeService([
      {
        family: 'Bare Face',
        fileId: 'f2',
        path: 'https://cdn.example.com/bare.otf',
      },
    ]);

    await service.loadOrgFonts('org1');

    expect(registerFontMock).toHaveBeenCalledTimes(1);
    expect(registerFontMock.mock.calls[0][1]).toEqual({
      family: 'Bare Face',
      weight: '400',
    });
  });

  it('makes every registered weight resolvable for outline extraction', async () => {
    const service = makeService([
      {
        family: 'Acme Sans',
        fileId: 'f1',
        path: 'https://cdn.example.com/acme.ttf',
        weights: [400, 700],
      },
    ]);

    const bold = await service.resolveFontFile('org1', 'Acme Sans', 700);
    expect(bold).toMatch(/f1\.ttf$/);
    // ...and the requesting org only: another org must not resolve it.
    expect(await service.resolveFontFile('org2', 'Acme Sans', 700)).toBeNull();
  });

  it('never hands a WOFF2 to the outline parser, though it downloads fine', async () => {
    const service = makeService([
      {
        family: 'Woff Face',
        fileId: 'f3',
        path: 'https://cdn.example.com/woff.woff2',
        weights: [400],
      },
    ]);

    expect(await service.resolveFontFile('org1', 'Woff Face', 400)).toBeNull();
  });
});
