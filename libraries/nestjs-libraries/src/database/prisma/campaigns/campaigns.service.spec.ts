import { describe, it, expect, vi } from 'vitest';
import { CampaignsService } from './campaigns.service';

function makeService(overrides: any = {}) {
  const campaignsRepository = {
    create: vi.fn().mockResolvedValue({ id: 'c1' }),
    update: vi.fn().mockResolvedValue({ id: 'c1' }),
    findById: vi.fn().mockResolvedValue({
      id: 'c1',
      organizationId: 'org1',
      name: 'Launch',
      goals: null,
      createdById: 'u1',
      shareToken: 'secret-token',
      shareEnabled: true,
    }),
    findByOrg: vi.fn().mockResolvedValue([]),
    getEngagement: vi.fn().mockResolvedValue({ totalComments: 0 }),
    getPostStateCounts: vi.fn().mockResolvedValue({}),
    getUpcomingQueuePosts: vi.fn().mockResolvedValue([]),
    getCampaignClickTotal: vi.fn().mockResolvedValue(0),
    getCappedItemsByCampaign: vi
      .fn()
      .mockResolvedValue([{ entityId: 'i3', createdAt: new Date(0) }]),
    findActiveCampaigns: vi.fn().mockResolvedValue([]),
    getSummaryPosts: vi.fn().mockResolvedValue([]),
    getClickTotalsForPosts: vi.fn().mockResolvedValue(new Map()),
    ...overrides.campaignsRepository,
  };
  const campaignItems = {
    countByCampaignGroupedByType: vi
      .fn()
      .mockResolvedValue([{ entityType: 'INTEGRATION' }]),
    copyAllToCampaign: vi.fn().mockResolvedValue(undefined),
    ...overrides.campaignItems,
  };
  const campaignTagService = {
    copyTags: vi.fn().mockResolvedValue(undefined),
    ...overrides.campaignTagService,
  };
  const campaignItemResolver = {
    resolveBatch: vi
      .fn()
      .mockResolvedValue(
        new Map([['i3', { id: 'i3', name: 'YouTube', icon: 'youtube', subtitle: 'youtube' }]])
      ),
  };
  const audit = { findByEntity: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(undefined) };
  const postsService = {
    getCampaignPosts: vi.fn().mockResolvedValue([
      { integration: { id: 'i1', name: 'X', providerIdentifier: 'x', picture: 'p1' } },
      { integration: { id: 'i1', name: 'X', providerIdentifier: 'x', picture: 'p1' } },
      { integration: { id: 'i2', name: 'LI', providerIdentifier: 'linkedin', picture: null } },
    ]),
    getCampaignDrafts: vi.fn().mockResolvedValue({}),
    buildCreateDtoFromPost: vi.fn().mockReturnValue({}),
    createPost: vi.fn().mockResolvedValue([]),
    setDraftPending: vi.fn().mockResolvedValue(undefined),
    ...overrides.postsService,
  };
  const usersService = {
    getNamesByIds: vi.fn().mockResolvedValue(new Map()),
    getPublicProfilesByIds: vi
      .fn()
      .mockResolvedValue(
        new Map([['u1', { id: 'u1', name: 'Maya Chen', email: 'm@a.test', avatarUrl: null }]])
      ),
  };
  const socialCommentsService = { countCampaignComments: vi.fn().mockResolvedValue(0) };
  const fileService = { getByIds: vi.fn().mockResolvedValue([]) };

  const service = new CampaignsService(
    campaignsRepository as any,
    campaignItems as any,
    campaignTagService as any,
    campaignItemResolver as any,
    audit as any,
    postsService as any,
    usersService as any,
    socialCommentsService as any,
    fileService as any
  );
  return { service, campaignsRepository, campaignItems, campaignTagService, postsService, usersService, audit };
}

describe('CampaignsService', () => {
  it('passes client/project/tags through create', async () => {
    const { service, campaignsRepository } = makeService();
    await service.create({
      organizationId: 'org1',
      name: 'Launch',
      client: 'Acme',
      project: 'v4',
      tags: ['paid', 'launch'],
    });
    expect(campaignsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'Acme', project: 'v4', tags: ['paid', 'launch'] })
    );
  });

  it('validates goals on create and rejects non-array shapes', async () => {
    const { service, campaignsRepository } = makeService();
    await expect(
      service.create({
        organizationId: 'org1',
        name: 'Launch',
        goals: { metric: 'posts', target: 10 } as any,
      })
    ).rejects.toBeInstanceOf(Error);
    expect(campaignsRepository.create).not.toHaveBeenCalled();
  });

  it('validates goals on create and rejects invalid goal fields', async () => {
    const { service, campaignsRepository } = makeService();
    await expect(
      service.create({
        organizationId: 'org1',
        name: 'Launch',
        goals: [{ metric: '', target: -1 }],
      })
    ).rejects.toBeInstanceOf(Error);
    expect(campaignsRepository.create).not.toHaveBeenCalled();
  });

  it('passes validated goals through create', async () => {
    const { service, campaignsRepository } = makeService();
    await service.create({
      organizationId: 'org1',
      name: 'Launch',
      goals: [{ metric: 'posts', target: 10 }],
    });
    expect(campaignsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ goals: [{ metric: 'posts', target: 10 }] })
    );
  });

  it('validates goals on update and strips undefined goals', async () => {
    const { service, campaignsRepository } = makeService();
    await service.update('c1', 'org1', { name: 'Renamed' });
    expect(campaignsRepository.update).toHaveBeenCalledWith(
      'c1',
      'org1',
      expect.objectContaining({ name: 'Renamed', goals: undefined })
    );
  });

  it('rejects create when endDate is not after startDate', async () => {
    const { service, campaignsRepository } = makeService();
    await expect(
      service.create({
        organizationId: 'org1',
        name: 'Launch',
        startDate: new Date('2024-02-01'),
        endDate: new Date('2024-01-01'),
      })
    ).rejects.toThrow('endDate must be after startDate');
    expect(campaignsRepository.create).not.toHaveBeenCalled();
  });

  it('rejects update when endDate equals startDate', async () => {
    const { service, campaignsRepository } = makeService();
    await expect(
      service.update('c1', 'org1', {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-01'),
      })
    ).rejects.toThrow('endDate must be after startDate');
    expect(campaignsRepository.update).not.toHaveBeenCalled();
  });

  it('strips shareToken/shareEnabled from single get', async () => {
    const { service } = makeService();
    const result = await service.get('c1', 'org1');
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('shareToken');
    expect(result).not.toHaveProperty('shareEnabled');
    expect(result).toHaveProperty('name', 'Launch');
  });

  it('strips shareToken/shareEnabled from list responses', async () => {
    const { service, campaignsRepository } = makeService({
      campaignsRepository: {
        findByOrg: vi.fn().mockResolvedValue([
          {
            id: 'c1',
            name: 'Launch',
            shareToken: 'secret',
            shareEnabled: true,
            posts: [{ integrationId: 'i1' }],
          },
        ]),
      },
    });
    const result = await service.list('org1');
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('shareToken');
    expect(result[0]).not.toHaveProperty('shareEnabled');
    expect(result[0]).toHaveProperty('integrationIds');
  });

  it('keeps shareToken/shareEnabled on the authenticated dashboard response', async () => {
    // The dashboard header's share control needs the token/state to build & toggle the
    // public link. This is the authenticated, org-scoped surface (get/list and the public
    // report still strip it — see toPublicJson / the strip tests above).
    const { service } = makeService();
    const dash = await service.getDashboard('c1', 'org1');
    expect(dash.campaign).toHaveProperty('shareToken');
    expect(dash.campaign).toHaveProperty('shareEnabled');
    expect(dash.campaign).toHaveProperty('createdBy');
  });

  it('builds the channel union (post-derived + tagged), deduped with postCount', async () => {
    const { service } = makeService();
    const dash = await service.getDashboard('c1', 'org1');
    // i1 appears in two posts, i2 in one, i3 is tagged-only (no posts).
    expect(dash.channels).toEqual([
      { id: 'i1', name: 'X', picture: 'p1', providerIdentifier: 'x', postCount: 2 },
      { id: 'i2', name: 'LI', picture: null, providerIdentifier: 'linkedin', postCount: 1 },
      { id: 'i3', name: 'YouTube', picture: null, providerIdentifier: 'youtube', postCount: 0 },
    ]);
  });

  it('resolves createdBy into a linkable profile object', async () => {
    const { service, usersService } = makeService();
    const dash = await service.getDashboard('c1', 'org1');
    expect(usersService.getPublicProfilesByIds).toHaveBeenCalledWith(['u1']);
    expect(dash.campaign.createdBy).toEqual({
      id: 'u1',
      name: 'Maya Chen',
      email: 'm@a.test',
      avatarUrl: null,
    });
  });

  it('returns batched active campaign summaries with post counts and goals', async () => {
    const { service, campaignsRepository } = makeService({
      campaignsRepository: {
        findActiveCampaigns: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'Launch', endDate: null, goals: [{ metric: 'posts', target: 10 }] },
          { id: 'c2', name: 'Relaunch', endDate: null, goals: [{ metric: 'likes', target: 100 }] },
        ]),
        getSummaryPosts: vi.fn().mockResolvedValue([
          { id: 'p1', campaignId: 'c1', state: 'QUEUE', lastViews: 0, lastLikes: 5, lastComments: 1 },
          { id: 'p2', campaignId: 'c1', state: 'PUBLISHED', lastViews: 100, lastLikes: 20, lastComments: 3 },
          { id: 'p3', campaignId: 'c2', state: 'ERROR', lastViews: 0, lastLikes: 0, lastComments: 0 },
        ]),
        getClickTotalsForPosts: vi.fn().mockResolvedValue(new Map([['p2', 42]])),
      },
    });

    const result = await service.getSummaries('org1', 6);

    expect(result).toHaveLength(2);
    expect(result[0].postCounts).toEqual({ queue: 1, published: 1, draft: 0, error: 0 });
    expect(result[0].goals).toContainEqual({ metric: 'posts', target: 10, current: 2, pct: 20 });
    expect(result[1].postCounts).toEqual({ queue: 0, published: 0, draft: 0, error: 1 });
  });

  it('copies utmEnabled, client, project and tags', async () => {
    const { service, campaignsRepository } = makeService({
      campaignsRepository: {
        findById: vi.fn().mockResolvedValue({
          id: 'src',
          organizationId: 'org1',
          name: 'Source',
          color: '#fff',
          description: 'desc',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-02-01'),
          goals: null,
          createdById: 'u1',
          utmEnabled: true,
          client: 'Acme',
          project: 'v4',
          tags: ['paid'],
        }),
      },
    });
    await service.copy('src', 'org1', 'u2', {});
    expect(campaignsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        utmEnabled: true,
        client: 'Acme',
        project: 'v4',
        tags: ['paid'],
      })
    );
  });

  it('handles drafts with no publishDate when copying', async () => {
    const postsService = {
      getCampaignDrafts: vi.fn().mockResolvedValue({
        group1: [{ id: 'd1', title: 'Draft without date', publishDate: null }],
      }),
      buildCreateDtoFromPost: vi.fn().mockReturnValue({}),
      createPost: vi.fn().mockResolvedValue([{ postId: 'p1' }]),
      setDraftPending: vi.fn().mockResolvedValue(undefined),
    };
    const { service, postsService: ps } = makeService({ postsService });

    await service.copy('c1', 'org1', 'u2', { shiftDates: true });
    expect(ps.createPost).toHaveBeenCalled();
    const dtoArg = ps.createPost.mock.calls[0][1];
    expect(dtoArg.date).toBeDefined();
    expect(() => new Date(dtoArg.date)).not.toThrow();
  });

  it('continues copying when a single draft fails and logs the error', async () => {
    const postsService = {
      getCampaignDrafts: vi.fn().mockResolvedValue({
        group1: [
          { id: 'd1', title: 'Bad draft', publishDate: new Date('2024-01-01') },
          { id: 'd2', title: 'Good draft', publishDate: new Date('2024-01-02') },
        ],
      }),
      buildCreateDtoFromPost: vi.fn().mockReturnValue({}),
      createPost: vi
        .fn()
        .mockRejectedValueOnce(new Error('validation failed'))
        .mockResolvedValueOnce([{ postId: 'p2' }]),
      setDraftPending: vi.fn().mockResolvedValue(undefined),
    };
    const { service, postsService: ps, audit } = makeService({ postsService });
    const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    await service.copy('c1', 'org1', 'u2', {});

    expect(ps.createPost).toHaveBeenCalledTimes(2);
    expect(ps.setDraftPending).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(audit.create).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
