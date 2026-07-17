import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGroupBy = vi.fn().mockResolvedValue([]);
const mockCreateSpendLog = vi.fn().mockResolvedValue(undefined);
const mockGetSettings = vi.fn().mockResolvedValue(null);

vi.mock('@gitroom/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class MockManager {
    getSettings = mockGetSettings;
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class MockAiSettings {
    createSpendLog = mockCreateSpendLog;
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({
  NotificationService: class MockNotifications {
    notifyBudgetThreshold = vi.fn().mockResolvedValue(undefined);
  },
}));

const mockComputeCost = vi.fn().mockReturnValue(0.123);
vi.mock('@reaatech/agent-budget-pricing', () => ({
  PricingEngine: class MockPricing {
    computeCost = mockComputeCost;
  },
}));

import { BudgetService } from './budget.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

const mockSpendLogRepo = { model: { aISpendLog: { groupBy: mockGroupBy } } };
const mockNotificationService = { notifyBudgetThreshold: vi.fn().mockResolvedValue(undefined) };

describe('BudgetService', () => {
  let service: BudgetService;

  function freshService() {
    return new BudgetService(
      new (AiSettingsManager as any)(),
      new (AiSettingsService as any)(),
      mockSpendLogRepo as any,
      mockNotificationService as any,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupBy.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue(null);
    service = freshService();
  });

  describe('checkBudget', () => {
    it('returns allowed:true when no caps are configured', async () => {
      mockGetSettings.mockResolvedValue({
        activeProvider: 'openai',
        activeModel: 'gpt-4.1',
      });
      service = freshService();
      const result = await service.checkBudget('utility', 'org-1');
      expect(result.allowed).toBe(true);
    });

    it('returns allowed:true when budgetSettings is empty', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: {},
      });
      service = freshService();
      const result = await service.checkBudget('utility', 'org-1');
      expect(result.allowed).toBe(true);
    });

    it('returns allowed:true even when a global monthly cap is configured', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      service = freshService();
      const result = await service.checkBudget('utility', 'org-1');
      expect(result.allowed).toBe(true);
    });

    it('returns allowed:true even when spend is over the global monthly cap', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      mockGroupBy
        .mockResolvedValueOnce([
          { organizationId: 'org-1', scope: 'utility', _sum: { costUsd: 150 } },
        ])
        .mockResolvedValueOnce([]);

      service = freshService();
      const result = await service.checkBudget('utility', 'org-1');
      expect(result.allowed).toBe(true);
    });

    it('returns allowed:true when no organizationId is provided', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: {
          perOrgCaps: { 'org-1': { monthly: 1 } },
        },
      });
      service = freshService();
      const result = await service.checkBudget('utility');
      expect(result.allowed).toBe(true);
    });
  });

  describe('recordSpend', () => {
    it('persists spend log via AiSettingsService', async () => {
      await service.recordSpend({
        organizationId: 'org-1',
        userId: 'user-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 100,
        outputTokens: 200,
        costUsd: 0.05,
      });
      expect(mockCreateSpendLog).toHaveBeenCalledTimes(1);
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          provider: 'openai',
          model: 'gpt-4.1',
          scope: 'utility',
          costUsd: 0.05,
        }),
      );
    });

    it('updates the in-memory accumulators', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      service = freshService();

      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 50,
        outputTokens: 50,
        costUsd: 0.01,
      });
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 50,
        outputTokens: 50,
        costUsd: 0.02,
      });

      const result = await service.checkBudget('utility', 'org-1');
      expect(result.allowed).toBe(true);
    });

    it('records spend without organizationId', async () => {
      await service.recordSpend({
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0.001,
      });
      expect(mockCreateSpendLog).toHaveBeenCalledTimes(1);
      const callArg = mockCreateSpendLog.mock.calls[0][0];
      expect(callArg.provider).toBe('openai');
      expect(callArg.model).toBe('gpt-4.1');
      expect(callArg.scope).toBe('utility');
      expect(callArg.organizationId).toBeUndefined();
    });

    it('derives cost from the pricing engine when costUsd is 0 (§6.1)', async () => {
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0,
      });
      expect(mockComputeCost).toHaveBeenCalledWith(1000, 500, 'gpt-4.1', 'openai');
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0.123 }),
      );
    });

    it('prefers the caller-supplied cost over the pricing engine', async () => {
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.07,
      });
      expect(mockComputeCost).not.toHaveBeenCalled();
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0.07 }),
      );
    });

    it('can be called multiple times in succession', async () => {
      for (let i = 0; i < 5; i++) {
        await service.recordSpend({
          organizationId: 'org-1',
          provider: 'openai',
          model: `gpt-4.1`,
          scope: 'utility',
          inputTokens: 10,
          outputTokens: 10,
          costUsd: 0.01,
        });
      }
      expect(mockCreateSpendLog).toHaveBeenCalledTimes(5);
    });
  });

  describe('cost resolution (_resolveCost / pricing engine)', () => {
    it('falls back to the caller cost when the pricing engine throws', async () => {
      mockComputeCost.mockImplementation(() => {
        throw new Error('pricing boom');
      });
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
      });
      expect(mockComputeCost).toHaveBeenCalled();
      // computeCost threw → cost stays at the caller-supplied 0
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0 }),
      );
    });

    it('falls back to the caller cost when the pricing engine returns a non-number', async () => {
      mockComputeCost.mockReturnValue('not-a-number' as any);
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
      });
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0 }),
      );
    });

    it('falls back to the caller cost when the pricing engine returns a negative number', async () => {
      mockComputeCost.mockReturnValue(-5);
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
      });
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0 }),
      );
    });

    it('reuses the cached pricing engine across calls', async () => {
      mockComputeCost.mockReturnValue(0.5);
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0,
      });
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0,
      });
      expect(mockComputeCost).toHaveBeenCalledTimes(2);
    });
  });

  describe('budget alerts (threshold firing + dedupe)', () => {
    it('fires a global-monthly budget alert once when crossing the 80% threshold', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      service = freshService();

      // globalMonthly starts at 0 (empty ledger); a single $80 spend hits 80% of $100.
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 80,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledWith(
        'org-1',
        'utility',
        80,
      );

      // A second spend crosses again but the alert key is already fired → no re-notify.
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 10,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledTimes(1);
    });

    it('does not fire a global-monthly alert below the threshold', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      service = freshService();

      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 50,
      });
      expect(mockNotificationService.notifyBudgetThreshold).not.toHaveBeenCalled();
    });

    it('honors a custom alertThresholdPct', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100, alertThresholdPct: 0.5 },
      });
      service = freshService();

      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 50,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledTimes(1);
    });

    it('fires a per-org monthly alert, normalizing a percent-style threshold (>1)', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: {
          perOrgCaps: { 'org-1': { monthly: 100, alertThresholdPct: 80 } },
        },
      });
      service = freshService();

      // rawOrgThreshold 80 > 1 → normalized to 0.8; $80 hits the per-org alert.
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 80,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledWith(
        'org-1',
        'utility',
        80,
      );
    });

    it('fires a per-org monthly alert using the default (sub-1) threshold and pre-existing ledger spend', async () => {
      // Seed the accumulator from the DB: org-1 already spent $40 this month/day.
      mockGroupBy
        .mockResolvedValueOnce([
          { organizationId: 'org-1', scope: 'utility', _sum: { costUsd: 40 } },
        ])
        .mockResolvedValueOnce([
          { organizationId: 'org-1', scope: 'utility', _sum: { costUsd: 40 } },
        ]);
      mockGetSettings.mockResolvedValue({
        budgetSettings: {
          perOrgCaps: { 'org-1': { monthly: 100 } },
        },
      });
      service = freshService();

      // 40 (ledger) + 40 (this spend) = 80 ≥ 100 * 0.8 default → fires.
      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 40,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledWith(
        'org-1',
        'utility',
        80,
      );
    });

    it('fires a global daily-cap alert when exceeded', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { dailyCap: 50 },
      });
      service = freshService();

      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 50,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledWith(
        'org-1',
        'daily_cap',
        100,
      );
    });

    it('fires a per-org daily-cap alert when exceeded', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: {
          perOrgCaps: { 'org-1': { daily: 25 } },
        },
      });
      service = freshService();

      await service.recordSpend({
        organizationId: 'org-1',
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 25,
      });
      expect(mockNotificationService.notifyBudgetThreshold).toHaveBeenCalledWith(
        'org-1',
        'daily_cap',
        100,
      );
    });

    it('does not notify when a cap is crossed but no organizationId is present', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      service = freshService();

      await service.recordSpend({
        provider: 'openai',
        model: 'gpt-4.1',
        scope: 'utility',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 80,
      });
      // global-monthly threshold crossed and logged, but notify is org-gated.
      expect(mockNotificationService.notifyBudgetThreshold).not.toHaveBeenCalled();
    });

    it('swallows a NotificationService failure without throwing', async () => {
      mockGetSettings.mockResolvedValue({
        budgetSettings: { monthlyCap: 100 },
      });
      mockNotificationService.notifyBudgetThreshold.mockRejectedValueOnce(
        new Error('notify down'),
      );
      service = freshService();

      await expect(
        service.recordSpend({
          organizationId: 'org-1',
          provider: 'openai',
          model: 'gpt-4.1',
          scope: 'utility',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 80,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
