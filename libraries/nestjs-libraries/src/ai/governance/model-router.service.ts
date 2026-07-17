import { Injectable, Logger } from '@nestjs/common';
import { AiSettingsManager } from '../ai-settings.manager';
import type { AIScope } from '../ai-provider.interface';

/**
 * Quality-based model routing (plan §6.1, decision table #29) — OPT-IN, OFF BY DEFAULT.
 *
 * Wraps `@reaatech/agent-budget-llm-router-plugin`'s `BudgetAwareStrategy`, which filters a
 * set of candidate models down to those that fit within remaining budget headroom (and can
 * block entirely when the budget is exhausted). On top of that we apply a "cheaper-first"
 * ordering so a scope tries an inexpensive model first and only escalates to a stronger
 * (costlier) one when configured to / when headroom allows.
 *
 * Disabled (default) ⇒ resolveModel() returns the single configured model unchanged ⇒
 * deterministic single-model behaviour identical to today.
 *
 * The `@reaatech/*` packages are early (0.1.x); we read their real exported types and guard
 * every call. If the plugin is unavailable, routing degrades to a minimal in-facade
 * cheapest-first selection behind the same flag rather than failing.
 */

export interface RoutingSettings {
  enabled?: boolean;
  // Per-scope ordered candidate model ids, cheapest → strongest. The configured/default model
  // is always appended as a guaranteed fallback if not already present.
  candidates?: Record<string, string[]>;
  // Optional cost hints keyed by model id (relative or USD-per-call); used for cheapest-first
  // ordering and to feed the plugin's budget-headroom filter.
  modelCosts?: Record<string, number>;
  // Default per-scope spend ceiling (USD) passed to the budget-aware strategy.
  scopeBudgetUsd?: number;
}

export interface ResolveModelResult {
  modelId: string;
  // True when the router actually changed the model from the configured one.
  routed: boolean;
  // True when the budget strategy blocked all candidates (caller may decide to proceed
  // with the configured model — we never hard-block here to preserve availability).
  blocked: boolean;
  reason?: string;
}

const SETTINGS_CACHE_TTL_MS = 30_000;

@Injectable()
export class ModelRouterService {
  private readonly _logger = new Logger(ModelRouterService.name);
  private _settingsCache: { value: RoutingSettings; ts: number } | null = null;

  // Lazy plugin handle: null = not yet attempted, false = unavailable, object = loaded module.
  private _plugin: any | null | false = null;

  constructor(private readonly _aiSettingsManager: AiSettingsManager) {}

  private async _getSettings(): Promise<RoutingSettings> {
    if (this._settingsCache && Date.now() - this._settingsCache.ts < SETTINGS_CACHE_TTL_MS) {
      return this._settingsCache.value;
    }
    let value: RoutingSettings = {};
    try {
      const settings = await this._aiSettingsManager.getSettings();
      const raw = settings?.routingSettings;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        value = raw as RoutingSettings;
      }
    } catch (err) {
      this._logger.warn(`Failed to read routingSettings: ${(err as Error).message}`);
    }
    this._settingsCache = { value, ts: Date.now() };
    return value;
  }

  private async _loadPlugin(): Promise<any | null> {
    if (this._plugin !== null) return this._plugin || null;
    try {
      const plugin = await import('@reaatech/agent-budget-llm-router-plugin');
      const engine = await import('@reaatech/agent-budget-engine');
      const tracker = await import('@reaatech/agent-budget-spend-tracker');
      const types = await import('@reaatech/agent-budget-types');
      this._plugin = { plugin, engine, tracker, types };
    } catch (err) {
      this._logger.warn(`agent-budget-llm-router-plugin unavailable, using in-facade routing: ${(err as Error).message}`);
      this._plugin = false;
    }
    return this._plugin || null;
  }

  /**
   * Builds the cheapest-first ordered candidate list for a scope, always including the
   * configured model as a guaranteed fallback.
   */
  private _orderCandidates(
    scope: AIScope | string,
    configuredModel: string,
    settings: RoutingSettings,
  ): string[] {
    const declared = settings.candidates?.[scope] ?? [];
    const set = [...declared];
    if (!set.includes(configuredModel)) set.push(configuredModel);

    const costs = settings.modelCosts ?? {};
    return [...set].sort((a, b) => {
      const ca = costs[a];
      const cb = costs[b];
      if (typeof ca === 'number' && typeof cb === 'number') return ca - cb;
      if (typeof ca === 'number') return -1;
      if (typeof cb === 'number') return 1;
      return 0;
    });
  }

  /**
   * Resolves the model id to use for a scope.
   *
   * @param scope            the AI surface (utility/generator/agent/mcp)
   * @param orgId            org for per-org budget scoping (never crosses orgs)
   * @param configuredModel  the model the facade already resolved (the deterministic default)
   * @param candidateModels  optional explicit candidate ids; merged with configured settings
   */
  async resolveModel(
    scope: AIScope | string,
    orgId: string | undefined,
    configuredModel: string,
    candidateModels?: string[],
  ): Promise<ResolveModelResult> {
    const settings = await this._getSettings();

    // Default OFF ⇒ deterministic single-model behaviour.
    if (!settings.enabled) {
      return { modelId: configuredModel, routed: false, blocked: false };
    }

    const mergedSettings: RoutingSettings = candidateModels?.length
      ? {
          ...settings,
          candidates: {
            ...settings.candidates,
            [scope]: [...(settings.candidates?.[scope] ?? []), ...candidateModels],
          },
        }
      : settings;

    const ordered = this._orderCandidates(scope, configuredModel, mergedSettings);
    if (ordered.length <= 1) {
      return { modelId: configuredModel, routed: false, blocked: false };
    }

    const loaded = await this._loadPlugin();
    if (!loaded) {
      // In-facade fallback: cheapest-first.
      const pick = ordered[0];
      return { modelId: pick, routed: pick !== configuredModel, blocked: false };
    }

    try {
      const { BudgetAwareStrategy } = loaded.plugin;
      const { BudgetController } = loaded.engine;
      const { SpendStore } = loaded.tracker;
      const { BudgetScope } = loaded.types;

      const spendTracker = new SpendStore();
      const controller = new BudgetController({ spendTracker });

      const scopeKey = orgId ? `org:${orgId}:${scope}` : `scope:${scope}`;
      const budgetUsd = mergedSettings.scopeBudgetUsd;
      if (typeof budgetUsd === 'number' && budgetUsd > 0) {
        controller.defineBudget({
          scopeType: BudgetScope.Org,
          scopeKey,
          limit: budgetUsd,
          policy: { softCap: budgetUsd * 0.8, hardCap: budgetUsd },
        });
      }

      const strategy = new BudgetAwareStrategy({ controller, defaultScopeType: BudgetScope.Org });
      const costs = mergedSettings.modelCosts ?? {};
      const result = strategy.select({
        scopeType: BudgetScope.Org,
        scopeKey,
        models: ordered.map((id) => ({ id, estimatedCost: costs[id] })),
      });

      if (result.blocked || !result.models?.length) {
        // Never hard-fail the generation — fall back to the configured model.
        return {
          modelId: configuredModel,
          routed: false,
          blocked: true,
          reason: result.reason,
        };
      }

      // The strategy returns budget-eligible models preserving our cheapest-first order;
      // escalate from cheapest.
      const pick = result.models[0].id;
      return { modelId: pick, routed: pick !== configuredModel, blocked: false };
    } catch (err) {
      this._logger.warn(`Model routing failed, using configured model: ${(err as Error).message}`);
      return { modelId: configuredModel, routed: false, blocked: false };
    }
  }
}
