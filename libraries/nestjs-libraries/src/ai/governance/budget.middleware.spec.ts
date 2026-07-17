import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockCheckBudget = vi.fn().mockResolvedValue({ allowed: true });
const mockGetSettings = vi.fn().mockResolvedValue(null);

vi.mock('@gitroom/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class {
    getSettings = mockGetSettings;
  },
}));

vi.mock('./budget.service', () => ({
  BudgetService: class {
    checkBudget = mockCheckBudget;
  },
}));

import { BudgetMiddleware } from './budget.middleware';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { BudgetService } from './budget.service';

function freshMiddleware() {
  return new BudgetMiddleware(
    new (AiSettingsManager as any)(),
    new (BudgetService as any)(),
  );
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    path: '/api/agents/generate',
    headers: {},
    org: undefined,
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('BudgetMiddleware', () => {
  let middleware: BudgetMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckBudget.mockResolvedValue({ allowed: true });
    mockGetSettings.mockResolvedValue(null);
    middleware = freshMiddleware();
    next = vi.fn();
  });

  describe('pass-through (no budget settings)', () => {
    it('calls next() when no settings are configured', async () => {
      await middleware.use(mockReq(), mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('calls next() when budgetSettings is empty', async () => {
      mockGetSettings.mockResolvedValue({ budgetSettings: {} });
      middleware = freshMiddleware();
      await middleware.use(mockReq(), mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(mockCheckBudget).not.toHaveBeenCalled();
    });

    it('does not call checkBudget when no caps are configured', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: {},
      });
      middleware = freshMiddleware();
      await middleware.use(mockReq(), mockRes(), next);
      expect(mockCheckBudget).not.toHaveBeenCalled();
    });
  });

  describe('scope identification', () => {
    it('identifies generator scope from /api/agents path', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/api/agents/generate' });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('generator', undefined);
    });

    it('identifies generator scope from /agents path', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/agents/edit' });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('generator', undefined);
    });

    it('identifies generator scope from /posts/generator path', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/posts/generator' });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('generator', undefined);
    });

    it('identifies agent scope from /copilot/ paths', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { dailyCap: 10 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/copilot/chat' });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('agent', undefined);
    });

    it('identifies mcp scope from /mcp/ paths', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/mcp/tools' });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('mcp', undefined);
    });

    it('identifies mcp scope from paths ending in /mcp', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/mcp' });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('mcp', undefined);
    });

    it('passes through for unrecognised scopes', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({ path: '/some/unknown/route' });

      await middleware.use(req, mockRes(), next);

      expect(next).toHaveBeenCalled();
      expect(mockCheckBudget).not.toHaveBeenCalled();
    });
  });

  describe('orgId extraction', () => {
    it('extracts orgId from req.org.id', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({
        path: '/api/agents/generate',
        org: { id: 'org-from-body' },
      });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('generator', 'org-from-body');
    });

    it('extracts orgId from x-org-id header', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({
        path: '/api/agents/generate',
        headers: { 'x-org-id': 'org-from-header' },
      });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('generator', 'org-from-header');
    });

    it('prefers req.org.id over header', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();
      const req = mockReq({
        path: '/api/agents/generate',
        org: { id: 'org-body' },
        headers: { 'x-org-id': 'org-header' },
      });

      await middleware.use(req, mockRes(), next);

      expect(mockCheckBudget).toHaveBeenCalledWith('generator', 'org-body');
    });
  });

  describe('budget enforcement', () => {
    it('allows request when budget is within limits', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      mockCheckBudget.mockResolvedValue({ allowed: true });
      middleware = freshMiddleware();

      await middleware.use(mockReq({ path: '/api/agents/generate' }), mockRes(), next);

      expect(next).toHaveBeenCalled();
    });

    it('blocks request with 429 when budget is exceeded', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      mockCheckBudget.mockResolvedValue({
        allowed: false,
        reason: 'Global monthly cap of $100 exceeded',
      });
      middleware = freshMiddleware();

      const res = mockRes();
      await middleware.use(mockReq({ path: '/api/agents/generate' }), res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        statusCode: 429,
        error: 'BudgetExceeded',
        message: 'Global monthly cap of $100 exceeded',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('includes the reason in the 429 response', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { dailyCap: 5 },
      });
      mockCheckBudget.mockResolvedValue({
        allowed: false,
        reason: 'Global daily cap of $5 exceeded',
      });
      middleware = freshMiddleware();

      const res = mockRes();
      await middleware.use(mockReq({ path: '/copilot/chat' }), res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Global daily cap of $5 exceeded',
        }),
      );
    });
  });

  describe('edge cases', () => {
    it('passes through when budgetSettings has all caps set to undefined', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: {
          monthlyCap: undefined,
          dailyCap: undefined,
          perOrgCaps: undefined,
          scopeCaps: undefined,
        },
      });
      middleware = freshMiddleware();

      await middleware.use(mockReq({ path: '/api/agents/generate' }), mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('works with GET requests', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      middleware = freshMiddleware();

      await middleware.use(mockReq({ method: 'GET', path: '/agents/list' }), mockRes(), next);
      expect(mockCheckBudget).toHaveBeenCalledWith('generator', undefined);
    });
  });
});
