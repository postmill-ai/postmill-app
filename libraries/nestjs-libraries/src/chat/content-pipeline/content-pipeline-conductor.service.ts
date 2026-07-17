import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { randomUUID } from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { dispatchToAgent } from '@reaatech/agent-mesh-router';
import type { AgentResponse } from '@reaatech/agent-mesh';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  CONTENT_PIPELINE_AGENTS,
  CONTENT_PIPELINE_AGENT_IDS,
} from './pipeline-registry.data';

export interface ContentBrief {
  brief: string;
  platforms?: string[];
  tone?: string;
}

export interface ContentPipelineResult {
  content: string[];
  perPlatform: Record<string, string>;
  critique?: { pass: boolean; fixes: string[] };
}

interface StrategistPlan {
  platforms: string[];
  angles?: string[];
  hooks?: string[];
  structure?: string;
}

interface PlatformLimit {
  id: string;
  maxLength: number;
}

@Injectable()
export class ContentPipelineConductorService {
  private readonly _logger = new Logger(
    ContentPipelineConductorService.name
  );

  // Per-(org, agent) circuit breaker. One tenant's broken AI provider must
  // never disable the pipeline for other orgs. Half-opens after RESET_MS.
  // Failure counts only accumulate within FAILURE_WINDOW_MS of the last
  // failure — stale entries are pruned on the next dispatch.
  private static readonly BREAKER_THRESHOLD = 5;
  private static readonly BREAKER_RESET_MS = 60_000;
  private static readonly BREAKER_FAILURE_WINDOW_MS = 10 * 60_000;

  // One overall wall-clock budget for the whole 4-to-5-stage run. The per-stage
  // timeout still bounds a single stage, but a single deadline stops the
  // per-stage 120s timeouts from compounding into a ~10-minute worst case.
  private static readonly DEFAULT_TOTAL_TIMEOUT_MS = 5 * 60_000;
  private readonly _breakers = new Map<
    string,
    { failures: number; openedAt: number; lastFailureAt: number }
  >();

  // Resolve agent configs from this pipeline's OWN registry data, not the shared
  // process-global `registryState` (which the AI Designer mesh also swaps —
  // whichever module inits last wins, so a global lookup is non-deterministic).
  private static readonly _agentMap = new Map<
    string,
    (typeof CONTENT_PIPELINE_AGENTS)[number]
  >(CONTENT_PIPELINE_AGENTS.map((a) => [a.agent_id, a]));

  // Conservative fallback limits for the few providers that may not expose a
  // maxLength() method through the kernel bridge.
  private static readonly DEFAULT_MAX_LENGTHS: Record<string, number> = {
    x: 280,
    linkedin: 3000,
    'linkedin-page': 3000,
    instagram: 2200,
    'instagram-standalone': 2200,
    facebook: 63206,
    threads: 500,
    bluesky: 300,
    mastodon: 500,
    youtube: 5000,
    tiktok: 2200,
    reddit: 40000,
    telegram: 4096,
    discord: 2000,
    slack: 40000,
    pinterest: 500,
  };

  constructor(
    private readonly _budget: BudgetService,
    private readonly _integrations: IntegrationManager,
    @Optional()
    private readonly _integrationService?: IntegrationService
  ) {}

  async generate(
    orgId: string,
    userId: string,
    brief: ContentBrief
  ): Promise<ContentPipelineResult> {
    const platforms =
      brief.platforms && brief.platforms.length > 0
        ? brief.platforms
        : ['x', 'linkedin'];

    // Single wall-clock budget shared by every stage of this run.
    const deadline = Date.now() + this._totalTimeoutMs();

    const plan = await this._runStrategist(orgId, userId, deadline, {
      brief: brief.brief,
      platforms,
      tone: brief.tone,
    });

    const versions = await this._buildProviderVersionMap(orgId, platforms);
    const platformLimits = this._buildPlatformLimits(platforms, versions);

    const perPlatform = await this._runCopywriter(orgId, userId, deadline, {
      plan,
      platformLimits,
      tone: brief.tone,
    });

    const initialCritique = await this._runBrandCritic(orgId, userId, deadline, {
      perPlatform,
      platforms,
      tone: brief.tone,
    });

    // K=1 revision loop: if the critic fails, run the copywriter once more
    // with the fixes, then proceed to finalization.
    if (!initialCritique.pass) {
      const revised = await this._runCopywriter(orgId, userId, deadline, {
        plan,
        platformLimits,
        tone: brief.tone,
        existingCopy: perPlatform,
        fixes: initialCritique.fixes,
      });
      // Update the copy for the final result; the finalizer receives the
      // revised copy regardless of a second critique.
      Object.assign(perPlatform, revised);
    }

    const finalized = await this._runFinalizer(orgId, userId, deadline, {
      perPlatform,
      plan,
    });

    // A total failure that survived the handlers as empty output must surface
    // as an error, not a success-shaped `{ content: [], perPlatform: {} }`.
    if (
      !finalized.perPlatform ||
      Object.keys(finalized.perPlatform).length === 0
    ) {
      throw new Error('Content pipeline produced no output');
    }

    return {
      content: finalized.content,
      perPlatform: finalized.perPlatform,
      critique: initialCritique,
    };
  }

  private async _runStrategist(
    orgId: string,
    userId: string,
    deadline: number,
    payload: { brief: string; platforms: string[]; tone?: string }
  ): Promise<StrategistPlan> {
    const response = await this._dispatch(CONTENT_PIPELINE_AGENT_IDS.strategist, payload, {
      orgId,
      userId,
      deadline,
    });
    const parsed = this._safeJson(response.content) as
      | Partial<StrategistPlan>
      | undefined;
    // Coerce wrong-typed LLM output to safe defaults so downstream stages (e.g.
    // the copywriter's `plan.angles.map`) never crash on a non-array shape.
    return {
      platforms: Array.isArray(parsed?.platforms)
        ? parsed.platforms
        : payload.platforms,
      angles: Array.isArray(parsed?.angles) ? parsed.angles : [],
      hooks: Array.isArray(parsed?.hooks) ? parsed.hooks : [],
      structure: typeof parsed?.structure === 'string' ? parsed.structure : '',
    };
  }

  private async _runCopywriter(
    orgId: string,
    userId: string,
    deadline: number,
    payload: {
      plan: StrategistPlan;
      platformLimits: PlatformLimit[];
      tone?: string;
      existingCopy?: Record<string, string>;
      fixes?: string[];
    }
  ): Promise<Record<string, string>> {
    const response = await this._dispatch(CONTENT_PIPELINE_AGENT_IDS.copywriter, payload, {
      orgId,
      userId,
      deadline,
    });
    const parsed = this._safeJson(response.content) as
      | { perPlatform?: Record<string, string> }
      | undefined;
    return parsed?.perPlatform ?? {};
  }

  private async _runBrandCritic(
    orgId: string,
    userId: string,
    deadline: number,
    payload: {
      perPlatform: Record<string, string>;
      platforms: string[];
      tone?: string;
    }
  ): Promise<{ pass: boolean; fixes: string[] }> {
    const response = await this._dispatch(CONTENT_PIPELINE_AGENT_IDS.brandCritic, payload, {
      orgId,
      userId,
      deadline,
    });
    const parsed = this._safeJson(response.content) as
      | Partial<{ pass: boolean; fixes: unknown }>
      | undefined;
    return {
      pass: !!parsed?.pass,
      fixes: Array.isArray(parsed?.fixes) ? (parsed.fixes as string[]) : [],
    };
  }

  private async _runFinalizer(
    orgId: string,
    userId: string,
    deadline: number,
    payload: {
      perPlatform: Record<string, string>;
      plan: StrategistPlan;
    }
  ): Promise<{ content: string[]; perPlatform: Record<string, string> }> {
    const response = await this._dispatch(CONTENT_PIPELINE_AGENT_IDS.finalizer, payload, {
      orgId,
      userId,
      deadline,
    });
    const parsed = this._safeJson(response.content) as
      | Partial<{
          content: string[];
          perPlatform: Record<string, string>;
        }>
      | undefined;
    return {
      content: Array.isArray(parsed?.content) ? parsed.content : [],
      perPlatform:
        parsed?.perPlatform && typeof parsed.perPlatform === 'object'
          ? (parsed.perPlatform as Record<string, string>)
          : payload.perPlatform,
    };
  }

  private async _dispatch(
    agentId: string,
    payload: Record<string, unknown>,
    ctx: { orgId: string; userId: string; deadline: number }
  ): Promise<AgentResponse> {
    const now = Date.now();

    // Opportunistically prune breaker entries whose last failure has aged out
    // of the failure window. The lazy per-key prune only ran when a broken key
    // was re-dispatched, so entries for never-retried (org, agent) pairs leaked
    // forever; sweep on any dispatch instead.
    this._sweepBreakers(now);

    const breakerKey = `${ctx.orgId}:${agentId}`;
    const breaker = this._breakers.get(breakerKey);
    if (
      breaker &&
      breaker.failures >=
        ContentPipelineConductorService.BREAKER_THRESHOLD &&
      now - breaker.openedAt <
        ContentPipelineConductorService.BREAKER_RESET_MS
    ) {
      throw new Error(`Circuit open for agent ${agentId}`);
    }

    // Single wall-clock budget across all stages. Reject before doing any work
    // once the overall deadline has passed instead of letting each stage burn
    // its own 120s timeout.
    const remaining = ctx.deadline - now;
    if (remaining <= 0) {
      throw new Error(
        `Content pipeline deadline exceeded before agent ${agentId}`
      );
    }

    // The finalizer makes no LLM call, so it has no spend to gate. The critic
    // spends under the 'utility' scope; everything else under 'agent'.
    const budgetScope = this._budgetScopeFor(agentId);
    if (budgetScope) {
      const budget = await this._budget.checkBudget(budgetScope, ctx.orgId);
      if (!budget.allowed) {
        throw new Error(budget.reason || 'AI budget exceeded');
      }
    }

    const agent = ContentPipelineConductorService._agentMap.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found in registry`);
    }

    const timeoutMs = Math.min(this._agentTimeoutMs(), remaining);
    let timer: NodeJS.Timeout | undefined;
    try {
      // NOTE (4.4): this Promise.race bounds only the CALLER'S WAIT. It does not
      // abort the in-flight dispatchToAgent work or its spend — no AbortSignal is
      // plumbed through agent-mesh, so a "timed out" stage keeps running to
      // completion; only the caller stops awaiting it. The overall-deadline check
      // (via `remaining`) likewise rejects BETWEEN stages, never mid-stage.
      // Threading a real AbortSignal is a tracked follow-up.
      const response = await Promise.race([
        dispatchToAgent(agent, {
          sessionId: `content-pipeline:${ctx.orgId}:${randomUUID()}`,
          employeeId: ctx.userId,
          displayName: 'Content Pipeline User',
          rawInput: JSON.stringify(payload),
          intentSummary: `dispatch to ${agentId}`,
          entities: {},
          detectedLanguage: 'en',
          turnHistory: [],
          workflowState: {},
          metadata: {
            orgId: ctx.orgId,
            userId: ctx.userId,
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Agent ${agentId} timed out after ${timeoutMs}ms`)
              ),
            timeoutMs
          );
        }),
      ]);
      this._breakers.delete(breakerKey);
      return response;
    } catch (err) {
      const prev = this._breakers.get(breakerKey);
      const withinWindow =
        prev &&
        Date.now() - prev.lastFailureAt <=
          ContentPipelineConductorService.BREAKER_FAILURE_WINDOW_MS;
      const failures = (withinWindow ? prev.failures : 0) + 1;
      this._breakers.set(breakerKey, {
        failures,
        lastFailureAt: Date.now(),
        openedAt:
          failures >= ContentPipelineConductorService.BREAKER_THRESHOLD
            ? Date.now()
            : 0,
      });
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async _buildProviderVersionMap(
    orgId: string,
    platforms: string[]
  ): Promise<Record<string, string> | undefined> {
    if (!this._integrationService) {
      return undefined;
    }

    try {
      const integrations =
        await this._integrationService.getIntegrationsList(orgId);
      const map: Record<string, string> = {};
      for (const integration of integrations) {
        if (
          platforms.includes(integration.providerIdentifier) &&
          integration.providerVersion
        ) {
          map[integration.providerIdentifier] = integration.providerVersion;
        }
      }
      return map;
    } catch {
      // Non-fatal: if the integration lookup fails we still want the pipeline
      // to run with default max-length fallbacks.
      return undefined;
    }
  }

  private _buildPlatformLimits(
    platforms: string[],
    versions?: Record<string, string>
  ): PlatformLimit[] {
    return platforms.map((id) => {
      let maxLength: number | undefined;
      try {
        const provider = this._integrations.getSocialIntegrationUnchecked(
          id,
          versions?.[id] ?? undefined
        );
        if (provider && typeof provider.maxLength === 'function') {
          maxLength = provider.maxLength();
        }
      } catch {
        // Fall through to defaults.
      }
      return {
        id,
        maxLength:
          maxLength ??
          ContentPipelineConductorService.DEFAULT_MAX_LENGTHS[id] ??
          10_000,
      };
    });
  }

  private _agentTimeoutMs(): number {
    const raw = Number(process.env.CONTENT_PIPELINE_AGENT_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
  }

  private _totalTimeoutMs(): number {
    const raw = Number(process.env.CONTENT_PIPELINE_TOTAL_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0
      ? raw
      : ContentPipelineConductorService.DEFAULT_TOTAL_TIMEOUT_MS;
  }

  private _budgetScopeFor(agentId: string): string | null {
    if (agentId === CONTENT_PIPELINE_AGENT_IDS.finalizer) {
      return null;
    }
    if (agentId === CONTENT_PIPELINE_AGENT_IDS.brandCritic) {
      return 'utility';
    }
    return 'agent';
  }

  private _sweepBreakers(now: number): void {
    for (const [key, breaker] of this._breakers) {
      if (
        now - breaker.lastFailureAt >
        ContentPipelineConductorService.BREAKER_FAILURE_WINDOW_MS
      ) {
        this._breakers.delete(key);
      }
    }
  }

  private _safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
}
