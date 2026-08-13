import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { FontLoaderService, boundedCacheSet, safeFileId } from './font-loader.service';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: vi.fn(),
}));

const safeFetchMock = safeFetch as ReturnType<typeof vi.fn>;

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
