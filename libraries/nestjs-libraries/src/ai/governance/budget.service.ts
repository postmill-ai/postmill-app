import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@postmill-ai/nestjs-libraries/ai/ai-settings.manager';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';

export interface BudgetSettings {
  monthlyCap?: number;
  dailyCap?: number;
  // 5.5: the per-org slice also carries `alertThresholdPct` (per-org alert
  // threshold, enforced in recordSpend). A per-org `enabled` kill-switch is
  // deliberately NOT enforced: the slice is org-writable (PUT /settings/ai/budget)
  // but a super-admin can impose a cap into the same slice via the governance
  // whole-blob route — honoring an org-written `enabled:false` would let a tenant
  // self-exempt from an operator-imposed cap. The org path also no longer
  // persists `enabled` (see OrgAiSettingsRepository#dtoToBudgetSlice).
  perOrgCaps?: Record<
    string,
    { monthly?: number; daily?: number; alertThresholdPct?: number }
  >;
  scopeCaps?: Record<string, { monthly?: number; daily?: number }>;
  alertThresholdPct?: number;
}

interface ProviderBudgetCaps {
  monthlyCap?: number;
  dailyCap?: number;
  alertThresholdPct?: number;
}

const AI_PROVIDER_BUDGET_ENFORCE = process.env.AI_PROVIDER_BUDGET_ENFORCE !== 'false';
const PROVIDER_CAPS_CACHE_TTL = 60_000;

@Injectable()
export class BudgetService {
  private readonly _logger = new Logger(BudgetService.name);
  private readonly DEFAULT_ALERT_THRESHOLD = 0.8;
  private readonly RESERVATION_BUFFER = 0.001;
  private readonly SPEND_ACCUMULATOR_TTL = 60_000;
  private readonly MAX_ORG_MAP_SIZE = 10_000;
  private readonly MAX_PROVIDER_MAP_SIZE = 50_000;
  // In-memory spend accumulator — tracks cumulative spend for the current month/day
  // to avoid re-querying the DB after each recordSpend call.
  private _spendAccum: {
    key: string;
    globalMonthly: number;
    globalDaily: number;
    orgMonthly: Map<string, number>;
    orgDaily: Map<string, number>;
    scopeMonthly: Map<string, number>;
    scopeDaily: Map<string, number>;
    providerMonthly: Map<string, number>;
    providerDaily: Map<string, number>;
    ts: number;
  } | null = null;

  private _sequenceNumber = 0;

  private _thresholdFired = new Set<string>();

  // 60s TTL cache for active provider budget caps to keep checkBudget cheap.
  private _providerCapsCache = new Map<
    string,
    { caps: ProviderBudgetCaps | null; ts: number }
  >();

  private _getAccumKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}::${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }

  private async _ensureAccum(): Promise<void> {
    if (
      this._spendAccum &&
      this._spendAccum.key === this._getAccumKey() &&
      Date.now() - this._spendAccum.ts < this.SPEND_ACCUMULATOR_TTL
    ) {
      return;
    }

    this._thresholdFired.clear();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totals, providerTotals] = await Promise.all([
      this._batchTotals(startOfMonth, startOfDay),
      this._batchProviderTotals(startOfMonth, startOfDay),
    ]);

    this._spendAccum = {
      key: this._getAccumKey(),
      ...this._computeMaps(totals, providerTotals),
      ts: Date.now(),
    };
  }

  // Aggregate a _batchTotals result into per-global/org/scope/provider sums.
  private _computeMaps(
    totals: { monthly: Record<string, number>; daily: Record<string, number> },
    providerTotals: { monthly: Record<string, number>; daily: Record<string, number> },
  ): {
    globalMonthly: number;
    globalDaily: number;
    orgMonthly: Map<string, number>;
    orgDaily: Map<string, number>;
    scopeMonthly: Map<string, number>;
    scopeDaily: Map<string, number>;
    providerMonthly: Map<string, number>;
    providerDaily: Map<string, number>;
  } {
    const orgMonthly = new Map<string, number>();
    const orgDaily = new Map<string, number>();
    const scopeMonthly = new Map<string, number>();
    const scopeDaily = new Map<string, number>();
    const providerMonthly = new Map<string, number>();
    const providerDaily = new Map<string, number>();

    for (const [key, val] of Object.entries(totals.monthly)) {
      if (key !== '__global::__any') {
        const [orgId] = key.split('::');
        orgMonthly.set(orgId, (orgMonthly.get(orgId) ?? 0) + val);
        scopeMonthly.set(key, (scopeMonthly.get(key) ?? 0) + val);
      }
    }
    for (const [key, val] of Object.entries(totals.daily)) {
      if (key !== '__global::__any') {
        const [orgId] = key.split('::');
        orgDaily.set(orgId, (orgDaily.get(orgId) ?? 0) + val);
        scopeDaily.set(key, (scopeDaily.get(key) ?? 0) + val);
      }
    }
    for (const [key, val] of Object.entries(providerTotals.monthly)) {
      providerMonthly.set(key, (providerMonthly.get(key) ?? 0) + val);
    }
    for (const [key, val] of Object.entries(providerTotals.daily)) {
      providerDaily.set(key, (providerDaily.get(key) ?? 0) + val);
    }

    return {
      globalMonthly: totals.monthly['__global::__any'] ?? 0,
      globalDaily: totals.daily['__global::__any'] ?? 0,
      orgMonthly,
      orgDaily,
      scopeMonthly,
      scopeDaily,
      providerMonthly,
      providerDaily,
    };
  }

  constructor(
    private _aiSettingsManager: AiSettingsManager,
    private _aiSettings: AiSettingsService,
    private _aiOrgProviderConfig: PrismaRepository<'aIOrgProviderConfig'>,
    private _spendLogRepo: PrismaRepository<'aISpendLog'>,
    private _notificationService: NotificationService,
  ) {}

  private async _getCaps(): Promise<BudgetSettings> {
    const settings = await this._aiSettingsManager.getSettings();
    const caps: BudgetSettings | undefined = settings?.budgetSettings;
    return caps ?? {};
  }

  private async _getProviderCaps(
    organizationId: string,
    provider: string,
  ): Promise<ProviderBudgetCaps | null> {
    const key = `${organizationId}::${provider}`;
    const cached = this._providerCapsCache.get(key);
    if (cached && Date.now() - cached.ts < PROVIDER_CAPS_CACHE_TTL) {
      return cached.caps;
    }

    const row = await this._aiOrgProviderConfig.model.aIOrgProviderConfig.findFirst({
      where: { organizationId, identifier: provider, isActive: true },
      select: {
        budgetMonthlyCap: true,
        budgetDailyCap: true,
        budgetAlertThresholdPct: true,
      },
    });

    const caps: ProviderBudgetCaps | null = row
      ? {
          monthlyCap: row.budgetMonthlyCap ?? undefined,
          dailyCap: row.budgetDailyCap ?? undefined,
          alertThresholdPct: row.budgetAlertThresholdPct ?? undefined,
        }
      : null;

    this._providerCapsCache.set(key, { caps, ts: Date.now() });
    return caps;
  }

  private async _providerSpend(
    organizationId: string,
    provider: string,
    startOfMonth: Date,
    startOfDay: Date,
  ): Promise<{ monthly: number; daily: number }> {
    const [monthlyRows, dailyRows] = await Promise.all([
      this._spendLogRepo.model.aISpendLog.groupBy({
        by: ['organizationId', 'provider'],
        where: { organizationId, provider, createdAt: { gte: startOfMonth } },
        _sum: { costUsd: true },
      }),
      this._spendLogRepo.model.aISpendLog.groupBy({
        by: ['organizationId', 'provider'],
        where: { organizationId, provider, createdAt: { gte: startOfDay } },
        _sum: { costUsd: true },
      }),
    ]);

    const monthly = monthlyRows.reduce(
      (s, r) => s + (r._sum?.costUsd ?? 0),
      0,
    );
    const daily = dailyRows.reduce(
      (s, r) => s + (r._sum?.costUsd ?? 0),
      0,
    );
    return { monthly, daily };
  }

  private async _batchTotals(
    startOfMonth: Date,
    startOfDay: Date,
    organizationId?: string,
  ): Promise<{ monthly: Record<string, number>; daily: Record<string, number> }> {
    // When an org is given, scope the aggregation to that org (cheap, indexed) instead of
    // scanning the whole ledger. Callers that need true cross-org global totals pass no org.
    const orgFilter = organizationId ? { organizationId } : {};
    const [monthlyRows, dailyRows] = await Promise.all([
      this._spendLogRepo.model.aISpendLog.groupBy({
        by: ['organizationId', 'scope'],
        where: { ...orgFilter, createdAt: { gte: startOfMonth } },
        _sum: { costUsd: true },
      }),
      this._spendLogRepo.model.aISpendLog.groupBy({
        by: ['organizationId', 'scope'],
        where: { ...orgFilter, createdAt: { gte: startOfDay } },
        _sum: { costUsd: true },
      }),
    ]);

    const monthly: Record<string, number> = {};
    for (const row of monthlyRows) {
      const key = `${row.organizationId ?? '__global'}::${row.scope ?? '__any'}`;
      monthly[key] = (monthly[key] ?? 0) + (row._sum?.costUsd ?? 0);
    }
    const globalMonthly = monthlyRows.reduce((s, r) => s + (r._sum?.costUsd ?? 0), 0);
    monthly['__global::__any'] = globalMonthly;

    const daily: Record<string, number> = {};
    for (const row of dailyRows) {
      const key = `${row.organizationId ?? '__global'}::${row.scope ?? '__any'}`;
      daily[key] = (daily[key] ?? 0) + (row._sum?.costUsd ?? 0);
    }
    const globalDaily = dailyRows.reduce((s, r) => s + (r._sum?.costUsd ?? 0), 0);
    daily['__global::__any'] = globalDaily;

    return { monthly, daily };
  }

  private async _batchProviderTotals(
    startOfMonth: Date,
    startOfDay: Date,
    organizationId?: string,
  ): Promise<{ monthly: Record<string, number>; daily: Record<string, number> }> {
    const orgFilter = organizationId ? { organizationId } : {};
    const [monthlyRows, dailyRows] = await Promise.all([
      this._spendLogRepo.model.aISpendLog.groupBy({
        by: ['organizationId', 'provider'],
        where: { ...orgFilter, createdAt: { gte: startOfMonth } },
        _sum: { costUsd: true },
      }),
      this._spendLogRepo.model.aISpendLog.groupBy({
        by: ['organizationId', 'provider'],
        where: { ...orgFilter, createdAt: { gte: startOfDay } },
        _sum: { costUsd: true },
      }),
    ]);

    const monthly: Record<string, number> = {};
    for (const row of monthlyRows) {
      const key = `${row.organizationId ?? '__global'}::${row.provider}`;
      monthly[key] = (monthly[key] ?? 0) + (row._sum?.costUsd ?? 0);
    }

    const daily: Record<string, number> = {};
    for (const row of dailyRows) {
      const key = `${row.organizationId ?? '__global'}::${row.provider}`;
      daily[key] = (daily[key] ?? 0) + (row._sum?.costUsd ?? 0);
    }

    return { monthly, daily };
  }

  async checkBudget(
    scope: string,
    organizationId?: string,
    provider?: string,
  ): Promise<{ allowed: boolean; reason?: string; provider?: string }> {
    // Kill-switch for the enforcement rollout. Alerts continue to fire regardless.
    if (!AI_PROVIDER_BUDGET_ENFORCE) {
      return { allowed: true };
    }

    // Provider budgets are org-scoped and BYOK: no provider or no org means no gate.
    if (!provider || !organizationId) {
      return { allowed: true };
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const caps = await this._getProviderCaps(organizationId, provider);
    if (!caps || (caps.monthlyCap == null && caps.dailyCap == null)) {
      return { allowed: true };
    }

    const spend = await this._providerSpend(
      organizationId,
      provider,
      startOfMonth,
      startOfDay,
    );
    const buffer = this.RESERVATION_BUFFER;

    if (caps.monthlyCap != null && spend.monthly >= caps.monthlyCap - buffer) {
      return {
        allowed: false,
        reason: 'provider_budget_exceeded',
        provider,
      };
    }

    if (caps.dailyCap != null && spend.daily >= caps.dailyCap - buffer) {
      return {
        allowed: false,
        reason: 'provider_budget_exceeded',
        provider,
      };
    }

    return { allowed: true };
  }

  // @reaatech/agent-budget-pricing — token→cost normalization. Lazy + guarded so an
  // unavailable package never blocks spend recording (falls back to the caller's costUsd).
  private _pricingEngine: any | null | false = null;

  private async _getPricingEngine(): Promise<any | null> {
    if (this._pricingEngine !== null) return this._pricingEngine || null;
    try {
      const { PricingEngine } = await import('@reaatech/agent-budget-pricing');
      this._pricingEngine = new PricingEngine();
    } catch (err) {
      this._logger.warn(`agent-budget-pricing unavailable: ${(err as Error).message}`);
      this._pricingEngine = false;
    }
    return this._pricingEngine || null;
  }

  // Authoritative cost = caller-supplied costUsd when present; otherwise derive it from
  // tokens via the pricing engine (§6.1). Returns the input unchanged on any failure.
  private async _resolveCost(data: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<number> {
    if (data.costUsd && data.costUsd > 0) return data.costUsd;
    const engine = await this._getPricingEngine();
    if (!engine) return data.costUsd;
    try {
      const computed = engine.computeCost(
        data.inputTokens ?? 0,
        data.outputTokens ?? 0,
        data.model,
        data.provider,
      );
      return typeof computed === 'number' && computed >= 0 ? computed : data.costUsd;
    } catch (err) {
      this._logger.warn(`Pricing computeCost failed for ${data.provider}/${data.model}: ${(err as Error).message}`);
      return data.costUsd;
    }
  }

  async recordSpend(data: {
    organizationId?: string;
    userId?: string;
    provider: string;
    model: string;
    scope: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<void> {
    data = { ...data, costUsd: await this._resolveCost(data) };
    await this._aiSettings.createSpendLog(data);

    await this._ensureAccum();

    const seq = this._sequenceNumber++;
    try {
      this._spendAccum!.globalMonthly += data.costUsd;
      this._spendAccum!.globalDaily += data.costUsd;

      if (data.organizationId) {
        if (
          this._spendAccum!.orgMonthly.size >= this.MAX_ORG_MAP_SIZE &&
          !this._spendAccum!.orgMonthly.has(data.organizationId)
        ) {
          this._logger.warn(
            `BudgetService: org map size (${this.MAX_ORG_MAP_SIZE}) exceeded, skipping tracking for org ${data.organizationId}`,
          );
        } else {
          this._spendAccum!.orgMonthly.set(
            data.organizationId,
            (this._spendAccum!.orgMonthly.get(data.organizationId) ?? 0) + data.costUsd,
          );
          this._spendAccum!.orgDaily.set(
            data.organizationId,
            (this._spendAccum!.orgDaily.get(data.organizationId) ?? 0) + data.costUsd,
          );
        }
      }

      const scopeKey = `${data.organizationId ?? '__global'}::${data.scope}`;
      if (
        this._spendAccum!.scopeMonthly.size >= this.MAX_ORG_MAP_SIZE &&
        !this._spendAccum!.scopeMonthly.has(scopeKey)
      ) {
        this._logger.warn(
          `BudgetService: scope map size (${this.MAX_ORG_MAP_SIZE}) exceeded, skipping tracking for scope ${scopeKey}`,
        );
      } else {
        this._spendAccum!.scopeMonthly.set(
          scopeKey,
          (this._spendAccum!.scopeMonthly.get(scopeKey) ?? 0) + data.costUsd,
        );
        this._spendAccum!.scopeDaily.set(
          scopeKey,
          (this._spendAccum!.scopeDaily.get(scopeKey) ?? 0) + data.costUsd,
        );
      }

      if (data.organizationId) {
        const providerKey = `${data.organizationId}::${data.provider}`;
        if (
          this._spendAccum!.providerMonthly.size >= this.MAX_PROVIDER_MAP_SIZE &&
          !this._spendAccum!.providerMonthly.has(providerKey)
        ) {
          this._logger.warn(
            `BudgetService: provider map size (${this.MAX_PROVIDER_MAP_SIZE}) exceeded, skipping tracking for provider ${providerKey}`,
          );
        } else {
          this._spendAccum!.providerMonthly.set(
            providerKey,
            (this._spendAccum!.providerMonthly.get(providerKey) ?? 0) + data.costUsd,
          );
          this._spendAccum!.providerDaily.set(
            providerKey,
            (this._spendAccum!.providerDaily.get(providerKey) ?? 0) + data.costUsd,
          );
        }
      }
    } finally {
      if (seq !== this._sequenceNumber - 1) {
        this._logger.warn('Concurrent modification detected on _spendAccum');
      }
    }

    const caps = await this._getCaps();
    const threshold = caps.alertThresholdPct ?? this.DEFAULT_ALERT_THRESHOLD;

    const thresholdPct = this._spendAccum!.globalMonthly / (caps.monthlyCap || 1);

    if (caps.monthlyCap && this._spendAccum!.globalMonthly >= caps.monthlyCap * threshold) {
      const alertKey = `global:monthly:${this._getAccumKey()}`;
      if (!this._thresholdFired.has(alertKey)) {
        this._thresholdFired.add(alertKey);
        this._logger.warn(
          `Budget alert: ${((this._spendAccum!.globalMonthly / caps.monthlyCap) * 100).toFixed(0)}% of global monthly cap ($${caps.monthlyCap}) used`,
        );
        if (data.organizationId) {
          try {
            await this._notificationService.notifyBudgetThreshold(data.organizationId, data.scope, thresholdPct * 100);
          } catch {}
        }
      }
    }

    if (data.organizationId) {
      const orgCaps = caps.perOrgCaps?.[data.organizationId];
      // 5.5: use the per-org alert threshold when the org set one, else the global.
      // Normalize a percent-style value (e.g. 80) to a fraction — the field name
      // says "Pct" and the DTO has no 0–1 range, so an API client sending 80
      // would otherwise set the alert point at cap×80 (never fires).
      const rawOrgThreshold = orgCaps?.alertThresholdPct ?? threshold;
      const orgThreshold =
        rawOrgThreshold > 1 ? rawOrgThreshold / 100 : rawOrgThreshold;
      const orgMonthly = this._spendAccum!.orgMonthly.get(data.organizationId) ?? 0;
      if (orgCaps?.monthly && orgMonthly >= orgCaps.monthly * orgThreshold) {
        const alertKey = `${data.organizationId}:monthly:${this._getAccumKey()}`;
        if (!this._thresholdFired.has(alertKey)) {
          this._thresholdFired.add(alertKey);
          this._logger.warn(
            `Budget alert: Org ${data.organizationId} at ${((orgMonthly / orgCaps.monthly) * 100).toFixed(0)}% of monthly cap`,
          );
          try {
            await this._notificationService.notifyBudgetThreshold(data.organizationId, data.scope, (orgMonthly / orgCaps.monthly) * 100);
          } catch {}
        }
      }
    }

    // Provider-scoped threshold alerts (monthly at threshold, daily at 100%).
    if (data.organizationId && data.provider) {
      const providerCaps = await this._getProviderCaps(data.organizationId, data.provider);
      if (providerCaps) {
        const providerKey = `${data.organizationId}::${data.provider}`;
        const providerThreshold =
          (providerCaps.alertThresholdPct ?? threshold) > 1
            ? (providerCaps.alertThresholdPct ?? threshold) / 100
            : (providerCaps.alertThresholdPct ?? threshold);
        const providerMonthly = this._spendAccum!.providerMonthly.get(providerKey) ?? 0;

        if (
          providerCaps.monthlyCap &&
          providerMonthly >= providerCaps.monthlyCap * providerThreshold
        ) {
          const alertKey = `${data.organizationId}:${data.provider}:monthly:${this._getAccumKey()}`;
          if (!this._thresholdFired.has(alertKey)) {
            this._thresholdFired.add(alertKey);
            const pct = (providerMonthly / providerCaps.monthlyCap) * 100;
            this._logger.warn(
              `Budget alert: Org ${data.organizationId} provider ${data.provider} at ${pct.toFixed(0)}% of monthly cap`,
            );
            try {
              await this._notificationService.notifyBudgetThreshold(
                data.organizationId,
                data.scope,
                pct,
                data.provider,
              );
            } catch {}
          }
        }

        const providerDaily = this._spendAccum!.providerDaily.get(providerKey) ?? 0;
        if (providerCaps.dailyCap && providerDaily >= providerCaps.dailyCap) {
          const alertKey = `${data.organizationId}:${data.provider}:daily:${this._getAccumKey()}`;
          if (!this._thresholdFired.has(alertKey)) {
            this._thresholdFired.add(alertKey);
            this._logger.warn(
              `Daily cap of $${providerCaps.dailyCap} exceeded for org ${data.organizationId} provider ${data.provider} ($${providerDaily.toFixed(4)})`,
            );
            try {
              await this._notificationService.notifyBudgetThreshold(
                data.organizationId,
                'daily_cap',
                100,
                data.provider,
              );
            } catch {}
          }
        }
      }
    }

    if (caps.dailyCap && this._spendAccum!.globalDaily >= caps.dailyCap) {
      const alertKey = `global:daily:${this._getAccumKey()}`;
      if (!this._thresholdFired.has(alertKey)) {
        this._thresholdFired.add(alertKey);
        this._logger.warn(
          `Daily cap of $${caps.dailyCap} exceeded ($${this._spendAccum!.globalDaily.toFixed(4)})`,
        );
        if (data.organizationId) {
          try {
            await this._notificationService.notifyBudgetThreshold(data.organizationId, 'daily_cap', 100);
          } catch {}
        }
      }
    }

    if (data.organizationId) {
      const orgCaps = caps.perOrgCaps?.[data.organizationId];
      const orgDaily = this._spendAccum!.orgDaily.get(data.organizationId) ?? 0;
      if (orgCaps?.daily && orgDaily >= orgCaps.daily) {
        const alertKey = `${data.organizationId}:daily:${this._getAccumKey()}`;
        if (!this._thresholdFired.has(alertKey)) {
          this._thresholdFired.add(alertKey);
          this._logger.warn(
            `Daily cap of $${orgCaps.daily} exceeded for org ${data.organizationId} ($${orgDaily.toFixed(4)})`,
          );
          try {
            await this._notificationService.notifyBudgetThreshold(data.organizationId, 'daily_cap', 100);
          } catch {}
        }
      }
    }
  }

}
