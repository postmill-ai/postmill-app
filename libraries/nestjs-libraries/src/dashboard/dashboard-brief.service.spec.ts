import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException, HttpException, HttpStatus } from '@nestjs/common';
import { DashboardBriefService } from './dashboard-brief.service';

const mockAiModelProvider = {
  resolveConfigForScope: vi.fn(),
  generateText: vi.fn(),
};

const mockBudgetService = {
  checkBudget: vi.fn(),
};

const mockDashboardService = {
  getAttention: vi.fn(),
  getSchedule: vi.fn(),
};

const mockAnalyticsService = {
  getOverview: vi.fn(),
};

const mockPostsService = {
  getTopPosts: vi.fn(),
};

const mockRedisService = {
  get: vi.fn(),
  set: vi.fn(),
};

describe('DashboardBriefService', () => {
  let service: DashboardBriefService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DashboardBriefService(
      mockAiModelProvider as any,
      mockBudgetService as any,
      mockDashboardService as any,
      mockAnalyticsService as any,
      mockPostsService as any,
      mockRedisService as any
    );
  });

  const mockOrg = { id: 'org-1', timezone: 'UTC' } as any;
  const mockUser = { id: 'user-1' } as any;

  it('returns cached false when no cache entry exists', async () => {
    mockRedisService.get.mockResolvedValue(null);

    const result = await service.getCachedBrief(mockOrg, mockUser);

    expect(result).toEqual({ cached: false });
  });

  it('returns parsed cached brief when present', async () => {
    const cached = { brief: 'already here', generatedAt: '2026-01-01T00:00:00Z' };
    mockRedisService.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.getCachedBrief(mockOrg, mockUser);

    expect(result).toEqual(cached);
  });

  it('throws 503 when AI provider is not configured', async () => {
    mockBudgetService.checkBudget.mockResolvedValue({ allowed: true });
    mockAiModelProvider.resolveConfigForScope.mockResolvedValue(null);

    await expect(service.generateBrief(mockOrg, mockUser, [])).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it('throws 429 when AI budget is exceeded', async () => {
    mockBudgetService.checkBudget.mockResolvedValue({ allowed: false, reason: 'Over budget' });

    await expect(service.generateBrief(mockOrg, mockUser, [])).rejects.toSatisfy(
      (err: HttpException) =>
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.TOO_MANY_REQUESTS &&
        err.message === 'Over budget'
    );
  });

  it('generates, caches, and returns a brief on success', async () => {
    mockBudgetService.checkBudget.mockResolvedValue({ allowed: true });
    mockAiModelProvider.resolveConfigForScope.mockResolvedValue({ providerId: 'openai' });
    mockRedisService.get.mockResolvedValue(null);
    mockDashboardService.getAttention.mockResolvedValue({ items: [] });
    mockAnalyticsService.getOverview.mockResolvedValue({
      kpis: [{ metric: 'impressions', label: 'Impressions', total: 1000 }],
      byChannel: [{ name: 'X', identifier: 'x' }],
    });
    mockPostsService.getTopPosts.mockResolvedValue([
      { id: 'p1', content: 'Hello', engagement: 10, integration: { name: 'X' } },
    ]);
    mockDashboardService.getSchedule.mockResolvedValue({ days: [{ date: '2026-01-01', count: 1 }], gaps: [] });
    mockAiModelProvider.generateText.mockResolvedValue('Your day looks clear.');
    mockRedisService.set.mockResolvedValue(undefined);

    const result = await service.generateBrief(mockOrg, mockUser, []);

    expect(result.brief).toBe('Your day looks clear.');
    expect(result.generatedAt).toBeTruthy();
    expect(mockAiModelProvider.generateText).toHaveBeenCalledWith(
      'utility',
      expect.stringContaining('Daily operations context'),
      expect.objectContaining({ orgId: 'org-1', system: expect.any(String) })
    );
    expect(mockRedisService.set).toHaveBeenCalledWith(
      expect.stringContaining('dashboard:brief:org-1:'),
      expect.any(String),
      expect.any(Number)
    );
  });

  it('single-flights concurrent generate requests so only one LLM call is made', async () => {
    mockBudgetService.checkBudget.mockResolvedValue({ allowed: true });
    mockAiModelProvider.resolveConfigForScope.mockResolvedValue({ providerId: 'openai' });
    mockRedisService.get.mockResolvedValue(null);
    mockDashboardService.getAttention.mockResolvedValue({ items: [] });
    mockAnalyticsService.getOverview.mockResolvedValue({ kpis: [], byChannel: [] });
    mockPostsService.getTopPosts.mockResolvedValue([]);
    mockDashboardService.getSchedule.mockResolvedValue({ days: [], gaps: [] });
    mockAiModelProvider.generateText.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('brief text'), 10))
    );
    mockRedisService.set.mockResolvedValue(undefined);

    const [a, b] = await Promise.all([
      service.generateBrief(mockOrg, mockUser, []),
      service.generateBrief(mockOrg, mockUser, []),
    ]);

    expect(a.brief).toBe('brief text');
    expect(b.brief).toBe('brief text');
    expect(mockAiModelProvider.generateText).toHaveBeenCalledTimes(1);
  });
});
