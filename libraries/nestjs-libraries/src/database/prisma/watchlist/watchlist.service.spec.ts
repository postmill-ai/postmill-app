import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';

describe('WatchlistService.getSeries (6.3 competitor overlay)', () => {
  let service: WatchlistService;
  let repo: any;

  beforeEach(() => {
    repo = {
      findByIdForOrg: vi.fn(),
      getMetricSeries: vi.fn(),
    };
    service = new WatchlistService(repo as any);
  });

  it('renders the seeded metric series (oldest-first, YYYY-MM-DD)', async () => {
    repo.findByIdForOrg.mockResolvedValue({
      id: 'w1', provider: 'x', handle: 'competitor', displayName: 'Rival',
    });
    repo.getMetricSeries.mockResolvedValue([
      { metric: 'followers', value: 100, capturedAt: new Date('2024-01-01T09:00:00.000Z') },
      { metric: 'followers', value: 120, capturedAt: new Date('2024-01-02T09:00:00.000Z') },
    ]);

    const result = await service.getSeries('w1', 'org1');

    expect(repo.findByIdForOrg).toHaveBeenCalledWith('w1', 'org1');
    expect(repo.getMetricSeries).toHaveBeenCalledWith('w1', 'followers');
    expect(result).toMatchObject({ id: 'w1', provider: 'x', handle: 'competitor', metric: 'followers' });
    expect(result.series).toEqual([
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 120 },
    ]);
  });

  it('returns an empty series when the account has no metrics yet', async () => {
    repo.findByIdForOrg.mockResolvedValue({ id: 'w1', provider: 'x', handle: 'c', displayName: null });
    repo.getMetricSeries.mockResolvedValue([]);

    const result = await service.getSeries('w1', 'org1');
    expect(result.series).toEqual([]);
  });

  it('404s a cross-org / missing account (org-scoped)', async () => {
    repo.findByIdForOrg.mockResolvedValue(null);
    await expect(service.getSeries('w1', 'org1')).rejects.toThrow(NotFoundException);
    expect(repo.getMetricSeries).not.toHaveBeenCalled();
  });

  it('honours a non-default metric param', async () => {
    repo.findByIdForOrg.mockResolvedValue({ id: 'w1', provider: 'x', handle: 'c', displayName: null });
    repo.getMetricSeries.mockResolvedValue([]);
    await service.getSeries('w1', 'org1', 'views');
    expect(repo.getMetricSeries).toHaveBeenCalledWith('w1', 'views');
  });
});
