import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsShareService } from './analytics-share.service';

describe('AnalyticsShareService (7.6)', () => {
  let repo: any;
  let overview: any;
  let service: AnalyticsShareService;

  beforeEach(() => {
    repo = {
      getShareByOrg: vi.fn(),
      getShareByToken: vi.fn(),
      upsertShare: vi.fn(),
      disableShare: vi.fn(),
    };
    overview = { getOverview: vi.fn() };
    service = new AnalyticsShareService(repo, overview);
  });

  it('mintShare upserts an enabled 64-hex token', async () => {
    repo.upsertShare.mockImplementation((_orgId: string, data: any) =>
      Promise.resolve({ organizationId: 'org-1', ...data }),
    );

    const result = await service.mintShare('org-1', { rangePreset: '7d' });

    const arg = repo.upsertShare.mock.calls[0][1];
    expect(arg.enabled).toBe(true);
    expect(arg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.config).toEqual({ rangePreset: '7d' });
    expect(result.token).toBe(arg.token);
  });

  it('mintShare rotates the token on re-mint', async () => {
    repo.upsertShare.mockImplementation((_orgId: string, data: any) =>
      Promise.resolve(data),
    );
    const first = await service.mintShare('org-1', {});
    const second = await service.mintShare('org-1', {});
    expect(first.token).not.toBe(second.token);
  });

  it('mintShare rejects unknown config keys', async () => {
    await expect(
      service.mintShare('org-1', { rangePreset: '7d', badKey: true } as any),
    ).rejects.toThrow();
    expect(repo.upsertShare).not.toHaveBeenCalled();
  });

  it('mintShare rejects invalid rangePreset values', async () => {
    await expect(
      service.mintShare('org-1', { rangePreset: '1y' } as any),
    ).rejects.toThrow();
    expect(repo.upsertShare).not.toHaveBeenCalled();
  });

  it('buildPublicReport returns null for an unknown token', async () => {
    repo.getShareByToken.mockResolvedValue(null);
    expect(await service.buildPublicReport('nope')).toBeNull();
    expect(overview.getOverview).not.toHaveBeenCalled();
  });

  it('buildPublicReport returns null for a disabled (rotated) token', async () => {
    repo.getShareByToken.mockResolvedValue({
      organizationId: 'org-1',
      token: 'stale',
      enabled: false,
      config: {},
    });
    expect(await service.buildPublicReport('stale')).toBeNull();
    expect(overview.getOverview).not.toHaveBeenCalled();
  });

  it('buildPublicReport returns ONLY the whitelist — no ids/org/integrationId leak', async () => {
    repo.getShareByToken.mockResolvedValue({
      id: 'share-id',
      organizationId: 'secret-org',
      token: 'live',
      enabled: true,
      config: { integrations: ['i1'], rangePreset: '30d' },
    });
    overview.getOverview.mockResolvedValue({
      range: { from: '2024-01-01', to: '2024-01-31' },
      kpis: [{ metric: 'followers', label: 'Followers', total: 100 }],
      series: { followers: [{ date: '2024-01-01', value: 100 }] },
      byChannel: [
        {
          integrationId: 'i1', // internal id — MUST NOT leak
          name: 'My Instagram',
          identifier: 'instagram',
          picture: 'https://cdn/secret.png', // MUST NOT leak
          kpis: [{ metric: 'followers', total: 100 }],
        },
      ],
      breakdown: { byPlatform: [{ identifier: 'instagram', value: 100 }] },
    });

    const report = await service.buildPublicReport('live');

    expect(overview.getOverview).toHaveBeenCalledWith(
      { id: 'secret-org' },
      expect.any(String), // rolling from-date resolved from rangePreset
      expect.any(String), // rolling to-date (today)
      ['i1'],
      false,
      {},
    );

    // Exact top-level key set — the security boundary.
    expect(Object.keys(report!).sort()).toEqual(
      ['byChannel', 'kpis', 'range', 'series'].sort(),
    );

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('secret-org');
    expect(serialized).not.toContain('share-id');
    expect(serialized).not.toContain('integrationId');
    expect(serialized).not.toContain('secret.png');

    // byChannel entries expose only name + identifier + kpis.
    expect(report!.byChannel).toEqual([
      {
        name: 'My Instagram',
        identifier: 'instagram',
        kpis: [{ metric: 'followers', total: 100 }],
      },
    ]);
    expect(report!.byChannel[0]).not.toHaveProperty('integrationId');
    expect(report!.byChannel[0]).not.toHaveProperty('picture');
  });

  it('disableShare returns success', async () => {
    repo.disableShare.mockResolvedValue({ count: 1 });
    expect(await service.disableShare('org-1')).toEqual({ success: true });
    expect(repo.disableShare).toHaveBeenCalledWith('org-1');
  });
});
