import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouterService } from './model-router.service';

function createService(settings: any) {
  const manager = { getSettings: vi.fn().mockResolvedValue(settings) } as any;
  return { service: new ModelRouterService(manager), manager };
}

describe('ModelRouterService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('disabled by default', () => {
    it('returns the configured model unchanged when settings are null', async () => {
      const { service } = createService(null);
      const result = await service.resolveModel('utility', 'org-1', 'gpt-4.1');
      expect(result.modelId).toBe('gpt-4.1');
      expect(result.routed).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('returns the configured model unchanged when explicitly disabled', async () => {
      const { service } = createService({ routingSettings: { enabled: false, candidates: { utility: ['cheap', 'strong'] } } });
      const result = await service.resolveModel('utility', 'org-1', 'gpt-4.1');
      expect(result.modelId).toBe('gpt-4.1');
      expect(result.routed).toBe(false);
    });
  });

  describe('enabled with no real candidates', () => {
    it('returns the configured model when only one candidate exists', async () => {
      const { service } = createService({ routingSettings: { enabled: true } });
      const result = await service.resolveModel('utility', 'org-1', 'gpt-4.1');
      expect(result.modelId).toBe('gpt-4.1');
      expect(result.routed).toBe(false);
    });
  });

  describe('enabled cheapest-first ordering', () => {
    it('selects the cheapest candidate using modelCosts', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['expensive', 'cheap'] },
          modelCosts: { expensive: 0.01, cheap: 0.0001 },
        },
      });
      const result = await service.resolveModel('utility', 'org-1', 'expensive');
      expect(result.modelId).toBe('cheap');
      expect(result.routed).toBe(true);
    });

    it('always includes the configured model as a fallback candidate', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['other'] },
          modelCosts: { other: 0.5, 'gpt-4.1': 0.001 },
        },
      });
      const result = await service.resolveModel('utility', 'org-1', 'gpt-4.1');
      // configured (cheapest) wins
      expect(result.modelId).toBe('gpt-4.1');
    });

    it('merges explicit candidateModels argument', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          modelCosts: { 'mini': 0.0001, 'gpt-4.1': 0.01 },
        },
      });
      const result = await service.resolveModel('utility', 'org-1', 'gpt-4.1', ['mini']);
      expect(result.modelId).toBe('mini');
      expect(result.routed).toBe(true);
    });
  });

  describe('budget-aware strategy (real plugin)', () => {
    it('does not block when budget headroom is ample', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['cheap', 'strong'] },
          modelCosts: { cheap: 0.0001, strong: 0.001 },
          scopeBudgetUsd: 100,
        },
      });
      const result = await service.resolveModel('utility', 'org-1', 'strong');
      expect(result.blocked).toBe(false);
      expect(result.modelId).toBe('cheap');
    });
  });

  describe('budget-blocked + error handling', () => {
    function fakePlugin(selectImpl: (req: any) => any) {
      return {
        plugin: { BudgetAwareStrategy: class { constructor(_o: any) {} select = selectImpl } },
        engine: { BudgetController: class { constructor(_o: any) {} defineBudget = vi.fn() } },
        tracker: { SpendStore: class {} },
        types: { BudgetScope: { Org: 'org' } },
      };
    }

    it('falls back to the configured model (blocked:true) when the strategy blocks', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['cheap', 'strong'] },
          modelCosts: { cheap: 0.001, strong: 0.002 },
          scopeBudgetUsd: 1,
        },
      });
      (service as any)._plugin = fakePlugin(() => ({ models: [], blocked: true, reason: 'over budget' }));
      const result = await service.resolveModel('utility', 'org-1', 'strong');
      expect(result.blocked).toBe(true);
      expect(result.modelId).toBe('strong');
      expect(result.reason).toBe('over budget');
    });

    it('falls back to the configured model when the strategy throws', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['cheap', 'strong'] },
          modelCosts: { cheap: 0.001, strong: 0.002 },
        },
      });
      (service as any)._plugin = fakePlugin(() => {
        throw new Error('strategy boom');
      });
      const result = await service.resolveModel('utility', 'org-1', 'strong');
      expect(result.modelId).toBe('strong');
      expect(result.routed).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('picks the strategy-filtered cheapest model on success', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['cheap', 'strong'] },
          modelCosts: { cheap: 0.001, strong: 0.002 },
          scopeBudgetUsd: 100,
        },
      });
      (service as any)._plugin = fakePlugin((req: any) => ({ models: req.models, blocked: false }));
      const result = await service.resolveModel('utility', 'org-1', 'strong');
      expect(result.modelId).toBe('cheap');
      expect(result.routed).toBe(true);
    });
  });

  describe('plugin unavailable fallback', () => {
    it('degrades to in-facade cheapest-first when the plugin import fails', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['expensive', 'cheap'] },
          modelCosts: { expensive: 0.01, cheap: 0.0001 },
        },
      });
      // Force the lazy plugin loader to report unavailable.
      (service as any)._plugin = false;
      const result = await service.resolveModel('utility', 'org-1', 'expensive');
      expect(result.modelId).toBe('cheap');
      expect(result.routed).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });

  describe('settings caching', () => {
    it('caches settings reads within the TTL', async () => {
      const { service, manager } = createService({ routingSettings: { enabled: false } });
      await service.resolveModel('utility', 'org-1', 'gpt-4.1');
      await service.resolveModel('utility', 'org-1', 'gpt-4.1');
      expect(manager.getSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-org scope keying', () => {
    it('uses an org-scoped key without crossing orgs', async () => {
      const { service } = createService({
        routingSettings: {
          enabled: true,
          candidates: { utility: ['a', 'b'] },
          modelCosts: { a: 0.001, b: 0.002 },
          scopeBudgetUsd: 50,
        },
      });
      const a = await service.resolveModel('utility', 'org-A', 'b');
      const b = await service.resolveModel('utility', 'org-B', 'b');
      expect(a.modelId).toBe('a');
      expect(b.modelId).toBe('a');
    });
  });
});
