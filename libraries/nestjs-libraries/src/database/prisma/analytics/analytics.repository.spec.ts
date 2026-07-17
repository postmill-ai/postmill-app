import { describe, expect, it, vi } from 'vitest';
import { AnalyticsRepository } from './analytics.repository';

describe('AnalyticsRepository — campaign scope (1.1)', () => {
  // Two campaigns (A/B) share one integration (i1). Seeded post snapshots are
  // tagged with the campaign of the post they belong to; the mock findMany
  // applies the `post.campaignId.in` relation filter, so the assertion proves
  // only the requested campaign's rows come back even though the channel is
  // shared.
  const seed = [
    { id: 's1', integrationId: 'i1', metric: 'likes', value: 10, date: new Date('2024-01-01'), _campaignId: 'A' },
    { id: 's2', integrationId: 'i1', metric: 'likes', value: 20, date: new Date('2024-01-02'), _campaignId: 'A' },
    { id: 's3', integrationId: 'i1', metric: 'likes', value: 99, date: new Date('2024-01-01'), _campaignId: 'B' },
  ];

  const makeRepo = () => {
    const findMany = vi.fn(async (args: any) => {
      const wanted: string[] = args.where.post.campaignId.in;
      const intFilter: string[] | undefined = args.where.integrationId?.in;
      return seed
        .filter((r) => wanted.includes(r._campaignId))
        .filter((r) => (intFilter ? intFilter.includes(r.integrationId) : true))
        .map(({ _campaignId, ...row }) => row);
    });
    const repo = Object.create(AnalyticsRepository.prototype) as AnalyticsRepository;
    (repo as any)._postAnalyticsSnapshot = {
      model: { postAnalyticsSnapshot: { findMany } },
    };
    return { repo, findMany };
  };

  it('getPostSnapshotsByCampaigns returns only the requested campaign rows', async () => {
    const { repo, findMany } = makeRepo();

    const rows = await repo.getPostSnapshotsByCampaigns(
      'org1',
      ['A'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    );

    // Only campaign A's rows, even though B shares integration i1.
    expect(rows.map((r: any) => r.id)).toEqual(['s1', 's2']);

    const where = findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe('org1');
    expect(where.post).toEqual({ campaignId: { in: ['A'] }, deletedAt: null });
    // No integration filter when omitted.
    expect(where.integrationId).toBeUndefined();
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ date: 'asc' });
  });

  it('getPostSnapshotsByCampaigns applies the optional integration filter', async () => {
    const { repo, findMany } = makeRepo();

    await repo.getPostSnapshotsByCampaigns(
      'org1',
      ['A', 'B'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
      ['i1'],
    );

    const where = findMany.mock.calls[0][0].where;
    expect(where.integrationId).toEqual({ in: ['i1'] });
    expect(where.post).toEqual({ campaignId: { in: ['A', 'B'] }, deletedAt: null });
  });

  // R1.3 baselines are read via a raw DISTINCT ON query (Prisma client-side
  // `distinct` would ship every pre-window row from the DB — see the repo
  // comment). The spec asserts the raw path is used, its params ride through,
  // and the degenerate inputs short-circuit without touching the DB.
  const makeRawRepo = () => {
    const queryRaw = vi.fn(async () => [
      { postId: 'p1', metric: 'likes', value: 90 },
    ]);
    const repo = Object.create(AnalyticsRepository.prototype) as AnalyticsRepository;
    (repo as any)._prisma = { $queryRaw: queryRaw };
    return { repo, queryRaw };
  };

  it('getLatestPostSnapshotsBeforeByCampaigns runs DISTINCT ON in the DB and returns the rows (R1.3)', async () => {
    const { repo, queryRaw } = makeRawRepo();
    const before = new Date('2024-02-01');

    const rows = await repo.getLatestPostSnapshotsBeforeByCampaigns(
      'org1',
      ['A'],
      before,
      ['i1'],
    );

    expect(rows).toEqual([{ postId: 'p1', metric: 'likes', value: 90 }]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // Tagged template: params ride as values (orgId, before, campaign ids,
    // integration ids); the SQL text carries DISTINCT ON + date DESC ordering.
    const [strings, ...values] = queryRaw.mock.calls[0] as any[];
    const sql = strings.join(' ');
    expect(sql).toContain('DISTINCT ON');
    expect(sql).toContain('"date" DESC');
    expect(values).toContainEqual('org1');
    expect(values).toContainEqual(before);
  });

  it('getLatestPostSnapshotsBeforeByCampaigns short-circuits on empty inputs (R1.3)', async () => {
    const { repo, queryRaw } = makeRawRepo();

    await expect(
      repo.getLatestPostSnapshotsBeforeByCampaigns('org1', [], new Date()),
    ).resolves.toEqual([]);
    await expect(
      repo.getLatestPostSnapshotsBeforeByCampaigns('org1', ['A'], new Date(), []),
    ).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('getPostsByCampaigns scopes by campaignId + org/date and includes integration', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = Object.create(AnalyticsRepository.prototype) as AnalyticsRepository;
    (repo as any)._post = { model: { post: { findMany } } };

    await repo.getPostsByCampaigns(
      'org1',
      ['A'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
      0,
      20,
    );

    const args = findMany.mock.calls[0][0];
    expect(args.where.campaignId).toEqual({ in: ['A'] });
    expect(args.where.organizationId).toBe('org1');
    expect(args.where.deletedAt).toBeNull();
    expect(args.include).toEqual({ integration: true });
    expect(args.orderBy).toEqual({ publishDate: 'desc' });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
  });

  it('countPostsByCampaigns scopes by campaignId', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repo = Object.create(AnalyticsRepository.prototype) as AnalyticsRepository;
    (repo as any)._post = { model: { post: { count } } };

    const total = await repo.countPostsByCampaigns(
      'org1',
      ['A'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    );

    expect(total).toBe(2);
    expect(count.mock.calls[0][0].where.campaignId).toEqual({ in: ['A'] });
  });
});


describe('AnalyticsRepository — org-scoped integration lookup (ANALYTICS-01)', () => {
  const makeRepo = (findFirst: ReturnType<typeof vi.fn>) => {
    const repo = Object.create(AnalyticsRepository.prototype) as AnalyticsRepository;
    (repo as any)._integration = {
      model: { integration: { findFirst } },
    };
    return repo;
  };

  it('returns the integration when it belongs to the requested org', async () => {
    const integration = {
      id: 'i1',
      organizationId: 'org1',
      providerIdentifier: 'x',
    };
    const findFirst = vi.fn().mockResolvedValue(integration);
    const repo = makeRepo(findFirst);

    const result = await repo.findIntegrationByIdRaw('i1', 'org1');

    expect(result).toEqual(integration);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'i1', organizationId: 'org1' },
    });
  });

  it('returns null when the integration belongs to a different organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = makeRepo(findFirst);

    const result = await repo.findIntegrationByIdRaw('i1', 'org2');

    expect(result).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'i1', organizationId: 'org2' },
    });
  });


});

describe('AnalyticsRepository — batch snapshot upserts (ANALYTICS-04 / ANALYTICS-05)', () => {
  const makePrismaRepo = () => {
    const analyticsDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const analyticsCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const postAnalyticsDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const postAnalyticsCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const $transaction = vi.fn(async (ops: any[]) => {
      for (const op of ops) await op;
      return [await ops[0], await ops[1]];
    });

    const repo = Object.create(AnalyticsRepository.prototype) as AnalyticsRepository;
    (repo as any)._prisma = {
      $transaction,
      analyticsSnapshot: { deleteMany: analyticsDeleteMany, createMany: analyticsCreateMany },
      postAnalyticsSnapshot: {
        deleteMany: postAnalyticsDeleteMany,
        createMany: postAnalyticsCreateMany,
      },
    };

    return {
      repo,
      $transaction,
      analyticsDeleteMany,
      analyticsCreateMany,
      postAnalyticsDeleteMany,
      postAnalyticsCreateMany,
    };
  };

  it('upsertChannelSnapshots deletes then creates rows keyed by org + integration + metric + date', async () => {
    const {
      repo,
      $transaction,
      analyticsDeleteMany,
      analyticsCreateMany,
    } = makePrismaRepo();

    const rows = [
      {
        organizationId: 'org1',
        integrationId: 'i1',
        metric: 'likes',
        value: 10,
        date: new Date('2024-01-01'),
      },
      {
        organizationId: 'org1',
        integrationId: 'i1',
        metric: 'views',
        value: 100,
        date: new Date('2024-01-02'),
      },
    ];

    await repo.upsertChannelSnapshots(rows);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(analyticsDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            organizationId: 'org1',
            integrationId: 'i1',
            metric: 'likes',
            date: rows[0].date,
          },
          {
            organizationId: 'org1',
            integrationId: 'i1',
            metric: 'views',
            date: rows[1].date,
          },
        ],
      },
    });
    expect(analyticsCreateMany).toHaveBeenCalledWith({
      data: rows,
      skipDuplicates: true,
    });
  });

  it('upsertPostSnapshots deletes then creates rows keyed by org + post + metric + date', async () => {
    const {
      repo,
      $transaction,
      postAnalyticsDeleteMany,
      postAnalyticsCreateMany,
    } = makePrismaRepo();

    const rows = [
      {
        organizationId: 'org1',
        postId: 'p1',
        integrationId: 'i1',
        metric: 'likes',
        value: 10,
        date: new Date('2024-01-01'),
      },
      {
        organizationId: 'org1',
        postId: 'p1',
        integrationId: 'i1',
        metric: 'views',
        value: 100,
        date: new Date('2024-01-02'),
      },
    ];

    await repo.upsertPostSnapshots(rows);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(postAnalyticsDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            organizationId: 'org1',
            postId: 'p1',
            metric: 'likes',
            date: rows[0].date,
          },
          {
            organizationId: 'org1',
            postId: 'p1',
            metric: 'views',
            date: rows[1].date,
          },
        ],
      },
    });
    expect(postAnalyticsCreateMany).toHaveBeenCalledWith({
      data: rows,
      skipDuplicates: true,
    });
  });

  it('batch upserts short-circuit on empty rows', async () => {
    const { repo, $transaction } = makePrismaRepo();

    const channelResult = await repo.upsertChannelSnapshots([]);
    const postResult = await repo.upsertPostSnapshots([]);

    expect($transaction).not.toHaveBeenCalled();
    expect(channelResult).toEqual({ count: 0 });
    expect(postResult).toEqual({ count: 0 });
  });
});
