import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '@mastra/core/di';
import { randomUUID } from 'node:crypto';
import { Organization } from '@prisma/client';
import { MastraService } from '@postmill-ai/nestjs-libraries/chat/mastra.service';
import { BudgetService } from '@postmill-ai/nestjs-libraries/ai/governance/budget.service';
import { TelemetryService } from '@postmill-ai/nestjs-libraries/ai/governance/telemetry.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  CommsConfirmationGate,
  PendingAction,
} from '@postmill-ai/nestjs-libraries/chat/tools/comms-confirmation.gate';

type CommsAgentContext = {
  organization: string;
  user: string;
  ui: string;
  access: string;
  // Comms-only keys: the deterministic thread + link the CommsConfirmationGate
  // parks outward actions against, and the parked action (if any) so the
  // prompt can tell the model a confirmation is still pending.
  thread: string;
  linkId: string;
  pendingConfirmation?: string;
};

export type CommsAgentReply = {
  text: string;
  threadId: string;
  // Set when this turn parked an outward action — the caller appends the
  // standard "Reply YES…" line if the model forgot it.
  pendingConfirmation?: { toolId: string; summary: string };
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
    private _gate: CommsConfirmationGate,
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
  }): Promise<CommsAgentReply> {
    const { orgId, userId, linkId, externalThreadKey, text } = params;
    const threadId = this.threadId(linkId, externalThreadKey);

    const budgetCheck = await this._budgetService.checkBudget('agent', orgId);
    if (!budgetCheck.allowed) {
      this._logger.warn(`Comms agent reply skipped for ${orgId}: budget exceeded`);
      return { text: BUDGET_REPLY, threadId };
    }

    const aiConfig = await this._aiModelProvider.resolveConfigForScope('agent', orgId);
    if (!aiConfig) {
      return { text: NOT_CONFIGURED_REPLY, threadId };
    }

    const organization = await this._organizationService.getOrgById(orgId);
    if (!organization) {
      return { text: ERROR_REPLY, threadId };
    }

    const pendingBefore = await this._gate.getPending(threadId);
    const requestContext = this._buildRequestContext(organization, userId, {
      threadId,
      linkId,
      pending: pendingBefore,
    });
    const mastra = await this._mastraService.mastra();
    const turnStartedAt = Date.now();

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
      // Did this turn park an outward action? Read it back from the gate
      // rather than parsing Mastra's step/tool-result shapes.
      const pendingAfter = await this._gate.getPending(threadId);
      const pendingConfirmation =
        pendingAfter && pendingAfter.createdAt >= turnStartedAt
          ? { toolId: pendingAfter.toolId, summary: pendingAfter.summary }
          : undefined;
      return {
        text: replyText.trim() || ERROR_REPLY,
        threadId,
        ...(pendingConfirmation ? { pendingConfirmation } : {}),
      };
    } catch (err) {
      // Timeouts, guardrail and provider errors all collapse into a short
      // apology — never leak internals into the chat app.
      this._logger.warn(
        `Comms agent reply failed for ${orgId} (thread=${threadId}): ${(err as Error).message}`,
      );
      return { text: ERROR_REPLY, threadId };
    }
  }

  /**
   * Execute an action the user just confirmed in chat. Re-invokes the parked
   * tool call through the gate with `access.confirmed` set — the same
   * firewall + validation chain as a model-initiated call. The caller has
   * already consumed the pending record (never double-run on a retry).
   */
  async runConfirmedAction(params: {
    orgId: string;
    userId: string;
    linkId: string;
    threadId: string;
    pending: PendingAction;
  }): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const { orgId, userId, linkId, threadId, pending } = params;

    if (pending.orgId !== orgId || pending.userId !== userId || pending.linkId !== linkId) {
      this._logger.warn(
        `Comms confirmed action refused: pending action belongs to another org/user/link (thread=${threadId})`,
      );
      return { ok: false, error: 'that confirmation is not yours to give' };
    }

    const budgetCheck = await this._budgetService.checkBudget('agent', orgId);
    if (!budgetCheck.allowed) {
      return { ok: false, error: 'the AI budget for this workspace is exhausted' };
    }
    const organization = await this._organizationService.getOrgById(orgId);
    if (!organization) {
      return { ok: false, error: 'workspace not found' };
    }
    // Ensures the tool registry the gate re-invokes through is populated.
    await this._mastraService.mastra();

    const requestContext = this._buildRequestContext(organization, userId, {
      threadId,
      linkId,
      confirmed: pending.confirmationId,
    });

    try {
      let result: unknown;
      await this._telemetryService.startSpan(
        'comms.agent.confirmed',
        async (span) => {
          span.setAttribute('ai.organizationId', orgId);
          span.setAttribute('ai.threadId', threadId);
          span.setAttribute('tool', pending.toolId);
          result = await this._withTimeout(
            this._gate.executeConfirmed(pending, requestContext),
            COMMS_AGENT_TIMEOUT_MS,
            `Comms confirmed action timed out after ${COMMS_AGENT_TIMEOUT_MS}ms`,
          );
        },
        { 'ai.scope': 'agent' },
      );
      return { ok: true, result };
    } catch (err) {
      this._logger.warn(
        `Comms confirmed action ${pending.toolId} failed for ${orgId} (thread=${threadId}): ${(err as Error).message}`,
      );
      return { ok: false, error: 'the action failed — please try again from the app' };
    }
  }

  /**
   * Record a turn that was answered in code (the YES/NO gate) in the thread's
   * memory, so the model's next turn sees what actually happened instead of
   * still believing an action is pending. Best-effort: a memory hiccup must
   * not fail the already-completed action.
   */
  async recordExchange(params: {
    orgId: string;
    threadId: string;
    userText: string;
    assistantText: string;
  }): Promise<void> {
    const { orgId, threadId, userText, assistantText } = params;
    try {
      const mastra = await this._mastraService.mastra();
      const memory = await mastra.getAgent('postmill').getMemory();
      if (!memory) return;
      const now = Date.now();
      const message = (role: 'user' | 'assistant', text: string, at: number) => ({
        id: randomUUID(),
        role,
        createdAt: new Date(at),
        threadId,
        resourceId: orgId,
        content: { format: 2 as const, parts: [{ type: 'text' as const, text }], content: text },
      });
      await memory.saveMessages({
        messages: [message('user', userText, now), message('assistant', assistantText, now + 1)],
      });
    } catch (err) {
      this._logger.warn(
        `Comms exchange not recorded (thread=${threadId}): ${(err as Error).message}`,
      );
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
    extra: {
      threadId: string;
      linkId: string;
      confirmed?: string;
      pending?: PendingAction | null;
    },
  ): RequestContext<CommsAgentContext> {
    const requestContext = new RequestContext<CommsAgentContext>();
    requestContext.set('organization', JSON.stringify(organization));
    // The linked human is a real, verified org user — unlike the digest's
    // synthetic 'system' user.
    requestContext.set('user', JSON.stringify({ id: userId }));
    requestContext.set('ui', 'false');
    requestContext.set(
      'access',
      JSON.stringify(
        extra.confirmed ? { mode: 'comms', confirmed: extra.confirmed } : { mode: 'comms' },
      ),
    );
    requestContext.set('thread', extra.threadId);
    requestContext.set('linkId', extra.linkId);
    if (extra.pending) {
      requestContext.set(
        'pendingConfirmation',
        JSON.stringify({ toolId: extra.pending.toolId, summary: extra.pending.summary }),
      );
    }
    return requestContext;
  }
}
