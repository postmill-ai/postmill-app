import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '@mastra/core/di';
import { Organization } from '@prisma/client';
import { MastraService } from '@postmill-ai/nestjs-libraries/chat/mastra.service';
import { BudgetService } from '@postmill-ai/nestjs-libraries/ai/governance/budget.service';
import { TelemetryService } from '@postmill-ai/nestjs-libraries/ai/governance/telemetry.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';

type CommsAgentContext = {
  organization: string;
  user: string;
  ui: string;
  access: string;
};

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

// Chat expects faster failure than the weekly digest — the human is waiting in
// their chat app.
const COMMS_AGENT_MAX_STEPS = parseEnvInt('COMMS_AGENT_MAX_STEPS', 10);
const COMMS_AGENT_TIMEOUT_MS = parseEnvInt('COMMS_AGENT_TIMEOUT_MS', 2 * 60 * 1000);

const BUDGET_REPLY =
  'The AI budget for this workspace is currently exhausted, so I cannot reply right now.';
const NOT_CONFIGURED_REPLY =
  'AI is not configured for this workspace yet — ask an admin to add an AI provider in settings.';
const ERROR_REPLY =
  "Sorry — I couldn't finish that reply. Please try again in a moment.";

/**
 * Headless agent turn for an inbound comms message. Mirrors
 * AgentDigestActivity step-for-step (budget + AI-config pre-checks, bounded
 * generate inside a telemetry span) but runs as the REAL linked user with
 * access mode 'comms', and uses a deterministic thread id so the conversation
 * is multi-turn and shows up under /agents. Always resolves to reply text —
 * error internals never reach the chat app.
 */
@Injectable()
export class CommsAgentActivity {
  private readonly _logger = new Logger(CommsAgentActivity.name);

  constructor(
    private _budgetService: BudgetService,
    private _mastraService: MastraService,
    private _organizationService: OrganizationService,
    private _aiModelProvider: AIModelProvider,
    private _telemetryService: TelemetryService,
  ) {}

  threadId(linkId: string, externalThreadKey: string): string {
    return `comms:${linkId}:${externalThreadKey}`;
  }

  async generateReply(params: {
    orgId: string;
    userId: string;
    linkId: string;
    externalThreadKey: string;
    text: string;
  }): Promise<{ text: string }> {
    const { orgId, userId, linkId, externalThreadKey, text } = params;

    const budgetCheck = await this._budgetService.checkBudget('agent', orgId);
    if (!budgetCheck.allowed) {
      this._logger.warn(`Comms agent reply skipped for ${orgId}: budget exceeded`);
      return { text: BUDGET_REPLY };
    }

    const aiConfig = await this._aiModelProvider.resolveConfigForScope('agent', orgId);
    if (!aiConfig) {
      return { text: NOT_CONFIGURED_REPLY };
    }

    const organization = await this._organizationService.getOrgById(orgId);
    if (!organization) {
      return { text: ERROR_REPLY };
    }

    const threadId = this.threadId(linkId, externalThreadKey);
    const requestContext = this._buildRequestContext(organization, userId);
    const mastra = await this._mastraService.mastra();

    try {
      let replyText = '';
      await this._telemetryService.startSpan(
        'comms.agent.generate',
        async (span) => {
          span.setAttribute('ai.organizationId', orgId);
          span.setAttribute('ai.threadId', threadId);

          const result = await this._withTimeout(
            mastra.getAgent('postmill').generate(text, {
              memory: {
                resource: orgId,
                thread: threadId,
              },
              requestContext,
              maxSteps: COMMS_AGENT_MAX_STEPS,
            }),
            COMMS_AGENT_TIMEOUT_MS,
            `Comms agent reply timed out after ${COMMS_AGENT_TIMEOUT_MS}ms`,
          );
          replyText = (result as { text?: string })?.text ?? '';
        },
        { 'ai.scope': 'agent' },
      );
      return { text: replyText.trim() || ERROR_REPLY };
    } catch (err) {
      // Timeouts, guardrail and provider errors all collapse into a short
      // apology — never leak internals into the chat app.
      this._logger.warn(
        `Comms agent reply failed for ${orgId} (thread=${threadId}): ${(err as Error).message}`,
      );
      return { text: ERROR_REPLY };
    }
  }

  private _withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]);
  }

  private _buildRequestContext(
    organization: Organization,
    userId: string,
  ): RequestContext<CommsAgentContext> {
    const requestContext = new RequestContext<CommsAgentContext>();
    requestContext.set('organization', JSON.stringify(organization));
    // The linked human is a real, verified org user — unlike the digest's
    // synthetic 'system' user.
    requestContext.set('user', JSON.stringify({ id: userId }));
    requestContext.set('ui', 'false');
    requestContext.set('access', JSON.stringify({ mode: 'comms' }));
    return requestContext;
  }
}
