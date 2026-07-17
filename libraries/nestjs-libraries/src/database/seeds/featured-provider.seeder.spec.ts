import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  FeaturedProviderSeeder,
  FEATURED_PROVIDERS,
} from './featured-provider.seeder';

type Repo = { upsert: ReturnType<typeof vi.fn> };

const makeSeeder = () => {
  const repo: Repo = { upsert: vi.fn().mockResolvedValue(undefined) };
  // The seeder only touches repo.upsert; the repository's Prisma wiring is
  // covered by featured-provider.repository.spec.ts.
  return { seeder: new FeaturedProviderSeeder(repo as never), repo };
};

describe('FeaturedProviderSeeder', () => {
  let seeder: FeaturedProviderSeeder;
  let repo: Repo;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ({ seeder, repo } = makeSeeder());
    // Silence the Nest logger; the log-content assertion below inspects the spy.
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts the canonical 12 rows in array order with exact args', async () => {
    await seeder.seed();

    expect(FEATURED_PROVIDERS).toHaveLength(12);
    expect(repo.upsert).toHaveBeenCalledTimes(12);
    FEATURED_PROVIDERS.forEach(({ domain, providerId, sortOrder }, i) => {
      expect(repo.upsert.mock.calls[i]).toEqual([domain, providerId, sortOrder]);
    });
  });

  it('re-asserts the same 12 upserts on a second run (idempotent)', async () => {
    await seeder.seed();
    await seeder.seed();

    expect(repo.upsert).toHaveBeenCalledTimes(24);
    FEATURED_PROVIDERS.forEach(({ domain, providerId, sortOrder }, i) => {
      expect(repo.upsert.mock.calls[12 + i]).toEqual([domain, providerId, sortOrder]);
    });
  });

  it('still attempts the remaining rows and resolves when one upsert rejects', async () => {
    const failing = FEATURED_PROVIDERS[4];
    repo.upsert.mockImplementation(async (domain: string, providerId: string) => {
      if (domain === failing.domain && providerId === failing.providerId) {
        throw new Error('boom');
      }
    });

    await expect(seeder.seed()).resolves.toBeUndefined();

    expect(repo.upsert).toHaveBeenCalledTimes(12);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      `Featured providers seeded (11/12 rows, 1 failed).`,
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs the exact full-success line when every row seeds', async () => {
    await seeder.seed();

    expect(logSpy).toHaveBeenCalledWith('Featured providers seeded (12 rows).');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
