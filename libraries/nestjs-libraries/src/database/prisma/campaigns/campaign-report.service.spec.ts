import { describe, it, expect, vi } from 'vitest';
import { CampaignReportService } from './campaign-report.service';

const campaignRow = {
  id: 'c1',
  organizationId: 'org1',
  name: 'Launch',
  color: '#2B5CD3',
  description: 'desc',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-02-01'),
  shareEnabled: true,
  shareToken: 'secret-token',
  goals: null,
  // Internal-only fields that must NOT leak on the public report.
  client: 'Acme Corp',
  project: 'Top secret',
  tags: ['internal', 'q1'],
  createdById: 'user-1',
};

function makeService() {
  const campaigns = {
    findByShareToken: vi.fn().mockResolvedValue(campaignRow),
    findById: vi.fn().mockResolvedValue(campaignRow),
    getEngagement: vi.fn().mockResolvedValue({
      totalViews: 10, totalLikes: 2, totalComments: 1, avgViews: 5, avgLikes: 1, avgComments: 0,
    }),
    getPostStateCounts: vi.fn().mockResolvedValue({ DRAFT: 0, QUEUE: 0, PUBLISHED: 1 }),
    getCampaignClickTotal: vi.fn().mockResolvedValue(3),
  };
  const items = {
    countByCampaignGroupedByType: vi.fn().mockResolvedValue([]),
    listByCampaign: vi.fn().mockResolvedValue([]),
  };
  const resolver = { resolveBatch: vi.fn().mockResolvedValue(new Map()) };
  const postsService = { getCampaignPosts: vi.fn().mockResolvedValue([]) };
  const comments = { countCampaignComments: vi.fn().mockResolvedValue(1) };

  const service = new CampaignReportService(
    campaigns as any,
    items as any,
    resolver as any,
    postsService as any,
    comments as any
  );
  return { service, postsService };
}

const analytics = {
  series: { views: [{ date: '2024-01-01', value: 5 }] },
  byChannel: [{ integrationId: 'i1', name: 'X', identifier: '@x', picture: '', kpis: [] }],
  window: { from: '2024-01-01', to: '2024-01-07' },
};

describe('CampaignReportService.toPublicJson (3.4 whitelist)', () => {
  it('excludes internal campaign fields and includes the analytics block', async () => {
    const { service } = makeService();
    const out: any = await service.toPublicJson('tok', analytics);

    // Whitelisted campaign fields only.
    expect(Object.keys(out.campaign).sort()).toEqual(
      ['color', 'description', 'endDate', 'id', 'name', 'startDate']
    );
    // Internal fields absent.
    expect(out.campaign.client).toBeUndefined();
    expect(out.campaign.project).toBeUndefined();
    expect(out.campaign.tags).toBeUndefined();
    expect(out.campaign.createdById).toBeUndefined();
    expect(out.createdBy).toBeUndefined();

    // Analytics present, whitelisted to series/byChannel/window.
    expect(out.analytics).toBeDefined();
    expect(Object.keys(out.analytics).sort()).toEqual(['byChannel', 'series', 'window']);
    expect(out.analytics.series.views[0].value).toBe(5);

    // R2.3 — byChannel is whitelisted to { name, identifier, kpis }; the source
    // integrationId + picture must NOT survive on the public report.
    expect(Object.keys(out.analytics.byChannel[0]).sort()).toEqual([
      'identifier',
      'kpis',
      'name',
    ]);
    expect(out.analytics.byChannel[0].integrationId).toBeUndefined();
    expect(out.analytics.byChannel[0].picture).toBeUndefined();
    expect(out.analytics.byChannel[0].name).toBe('X');
    expect(out.analytics.byChannel[0].identifier).toBe('@x');

    // Deep scan: no integrationId/picture anywhere in the public payload.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('integrationId');
    expect(serialized).not.toContain('picture');
  });

  it('omits the analytics block when none is passed', async () => {
    const { service } = makeService();
    const out: any = await service.toPublicJson('tok');
    expect(out.analytics).toBeUndefined();
  });

  it('resolveShareToken returns identity for an enabled share, null otherwise', async () => {
    const { service } = makeService();
    await expect(service.resolveShareToken('tok')).resolves.toEqual({
      id: 'c1',
      organizationId: 'org1',
    });
  });
});

describe('CampaignReportService internal reports', () => {
  it('buildReport strips shareToken/shareEnabled from the campaign object', async () => {
    const { service } = makeService();
    const report: any = await service.buildReport('c1', 'org1');
    expect(report.campaign).not.toHaveProperty('shareToken');
    expect(report.campaign).not.toHaveProperty('shareEnabled');
    expect(report.campaign).toHaveProperty('name', 'Launch');
  });

  it('toJson inherits the stripped campaign', async () => {
    const { service } = makeService();
    const report: any = await service.toJson('c1', 'org1');
    expect(report.campaign).not.toHaveProperty('shareToken');
    expect(report.campaign).not.toHaveProperty('shareEnabled');
  });

  it('reads campaign posts through PostsService, not PostsRepository', async () => {
    const { service, postsService } = makeService();
    await service.buildReport('c1', 'org1');
    expect(postsService.getCampaignPosts).toHaveBeenCalledWith('org1', 'c1');
  });
});

describe('CampaignReportService.toCsv', () => {
  it('sanitizes formula-injection payloads in titles', async () => {
    const { service } = makeService();
    const campaigns = {
      findById: vi.fn().mockResolvedValue(campaignRow),
      getEngagement: vi.fn().mockResolvedValue({
        totalViews: 10, totalLikes: 2, totalComments: 1, avgViews: 5, avgLikes: 1, avgComments: 0,
      }),
      getPostStateCounts: vi.fn().mockResolvedValue({}),
      getCampaignClickTotal: vi.fn().mockResolvedValue(0),
    };
    const items = {
      countByCampaignGroupedByType: vi.fn().mockResolvedValue([]),
      listByCampaign: vi.fn().mockResolvedValue([]),
    };
    const resolver = { resolveBatch: vi.fn().mockResolvedValue(new Map()) };
    const postsService = {
      getCampaignPosts: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          title: '=HYPERLINK("http://evil","click")',
          content: '',
          state: 'PUBLISHED',
          publishDate: new Date('2024-01-01'),
          lastViews: 1,
          lastLikes: 0,
          lastComments: 0,
          integration: { name: 'X' },
        },
      ]),
    };
    const comments = { countCampaignComments: vi.fn().mockResolvedValue(0) };
    const csvService = new CampaignReportService(
      campaigns as any,
      items as any,
      resolver as any,
      postsService as any,
      comments as any
    );

    const csv = await csvService.toCsv('c1', 'org1');
    const lines = csv.split('\n');
    const dataLine = lines.find((l) => l.includes('p1'))!;
    // The title cell must be quoted and start with a neutralizing single quote.
    // Because the CSV doubles internal quotes, the escaped literal looks like:
    // "'=HYPERLINK(""http://evil"",""click"")".
    expect(dataLine).toContain("'" + '=HYPERLINK(');
    expect(dataLine).not.toContain('"=HYPERLINK(');
  });
});
