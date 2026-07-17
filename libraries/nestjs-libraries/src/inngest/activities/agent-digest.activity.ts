import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContext } from '@mastra/core/di';
import { Organization } from '@prisma/client';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

type AgentDigestContext = {
  organization: string;
  user: string;
  ui: string;
  access: string;
};

const DIGEST_TITLE = 'Weekly agent brief ready';
const DIGEST_MESSAGE =
  "Your agent has drafted a next-week plan based on last week's performance.";

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

// Headless digest runs are bounded so a stuck tool loop / slow provider cannot
// hold the Inngest step indefinitely. The model itself is governed (guardrails,
// budget, telemetry, usage) via AIModelProvider.governedLanguageModel.
const DIGEST_MAX_STEPS = parseEnvInt('AGENT_DIGEST_MAX_STEPS', 10);
const DIGEST_TIMEOUT_MS = parseEnvInt('AGENT_DIGEST_TIMEOUT_MS', 5 * 60 * 1000);

export interface AgentDigestResult {
  threadId: string;
  notified: boolean;
  skipped?: boolean;
  reason?: string;
  title?: string;
  message?: string;
  error?: string;
}

@Injectable()
export class AgentDigestActivity {
  private readonly _logger = new Logger(AgentDigestActivity.name);
  private _digestTimeoutMs = DIGEST_TIMEOUT_MS;

  constructor(
    private _preferenceService: NotificationPreferenceService,
    private _budgetService: BudgetService,
    private _mastraService: MastraService,
    private _notificationService: NotificationService,
    private _organizationService: OrganizationService,
    private _aiModelProvider: AIModelProvider,
    private _telemetryService: TelemetryService,
  ) {}

  async generate(orgId: string): Promise<AgentDigestResult> {
    const threadId = randomUUID();

    const categoryEnabled = await this._preferenceService.orgHasCategoryEnabled(
      orgId,
      'agent'
    );
    if (!categoryEnabled) {
      this._logger.debug(`Skipping agent digest for ${orgId}: no opted-in members`);
      return { threadId, notified: false, skipped: true, reason: 'no_opt_in' };
    }

    const budgetCheck = await this._budgetService.checkBudget('agent', orgId);
    if (!budgetCheck.allowed) {
      this._logger.warn(
        `Skipping agent digest for ${orgId}: budget exceeded - ${budgetCheck.reason}`
      );
      return { threadId, notified: false, skipped: true, reason: 'budget_exceeded' };
    }

    const organization = await this._organizationService.getOrgById(orgId);
    if (!organization) {
      this._logger.warn(`Skipping agent digest for ${orgId}: organization not found`);
      return { threadId, notified: false, skipped: true, reason: 'org_not_found' };
    }

    // Pre-check the org's AI provider so an org with the `agent` category enabled
    // but no active provider skips cleanly instead of throwing a plain
    // Error(AI_NOT_CONFIGURED_MESSAGE) from generate() and retrying 4x forever.
    const aiConfig = await this._aiModelProvider.resolveConfigForScope('agent', orgId);
    if (!aiConfig) {
      this._logger.debug(
        `Skipping agent digest for ${orgId}: AI provider not configured`
      );
      return { threadId, notified: false, skipped: true, reason: 'ai_not_configured' };
    }

    const requestContext = this._buildRequestContext(organization);

    const digestPrompt = this._buildDigestPrompt();

    const mastra = await this._mastraService.mastra();
    try {
      await this._telemetryService.startSpan(
        'agent.digest.generate',
        async (span) => {
          span.setAttribute('ai.organizationId', orgId);
          span.setAttribute('ai.threadId', threadId);

          await this._withTimeout(
            mastra.getAgent('postmill').generate(digestPrompt, {
              memory: {
                resource: orgId,
                thread: threadId,
              },
              requestContext,
              maxSteps: DIGEST_MAX_STEPS,
            }),
            this._digestTimeoutMs,
            `Agent digest generation timed out after ${this._digestTimeoutMs}ms`,
          );
        },
        { 'ai.scope': 'agent' },
      );
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('timed out')) {
        this._logger.warn(`Agent digest for ${orgId} timed out`);
        return { threadId, notified: false, skipped: true, reason: 'timeout' };
      }
      // Other errors surface so Inngest retry semantics apply; guardrail/budget
      // violations from the governed model are thrown by the wrapper.
      throw err;
    }

    return { threadId, notified: false, title: DIGEST_TITLE, message: DIGEST_MESSAGE };
  }

  async notify(orgId: string, digest: AgentDigestResult): Promise<AgentDigestResult> {
    const { threadId } = digest;
    try {
      await this._notificationService.notify({
        orgId,
        category: 'agent',
        title: digest.title ?? DIGEST_TITLE,
        message: digest.message ?? DIGEST_MESSAGE,
        link: `/agents/${threadId}`,
      });
    } catch (err) {
      // 4.2: non-fatal (a digest must never crash the sweep) but honest — report
      // notified: false + the message so the step result carries the failure
      // instead of masquerading as a success. No rethrow (leave retry semantics).
      const message = (err as Error).message;
      this._logger.warn(
        `Agent digest notification failed for ${orgId}: ${message}`
      );
      return { threadId, notified: false, error: message };
    }

    return { threadId, notified: true };
  }

  private _withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      // Prevent the timer from keeping the process awake in tests / short-lived workers.
      if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]);
  }

  private _buildRequestContext(organization: Organization): RequestContext<AgentDigestContext> {
    const requestContext = new RequestContext<AgentDigestContext>();
    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('user', JSON.stringify({ id: 'system' }));
    requestContext.set('ui', 'false');
    requestContext.set('access', JSON.stringify({ mode: 'headless' }));
    return requestContext;
  }

  private _buildDigestPrompt(): string {
    return `You are running the weekly agent digest for this organization.
This is a headless, read-only run. Do not schedule, create, update, delete, or publish anything.

Use only the following read-only tools to gather context:
- analyticsOverview
- recommendations
- commentsInbox
- bestTime

Then produce a concise next-week content plan:
1. Summarize last week's performance in 2-3 sentences.
2. Identify 2-4 content opportunities or themes for the coming week.
3. Describe each proposed post in text (channel, timing, and angle). Do not execute any tool that would write to the calendar or create media jobs.

End with a brief note that these are draft suggestions and can be scheduled by opening this thread.`;
  }
}
