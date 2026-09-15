import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { getAccess, parseOrg, parseUser } from '@postmill-ai/nestjs-libraries/chat/tools/tool.helpers';
import { summarizeToolCall } from '@postmill-ai/nestjs-libraries/chat/tools/comms-action-summary';

export type PendingAction = {
  confirmationId: string;
  toolId: string;
  args: unknown;
  orgId: string;
  userId: string;
  linkId: string;
  threadId: string;
  summary: string;
  createdAt: number;
  expiresAt: number;
};

export type ParkedToolResult = {
  needsConfirmation: true;
  confirmationId: string;
  summary: string;
  instructions: string;
};

const PARKED_INSTRUCTIONS =
  'This action has NOT been executed. Do not call this tool again. Tell the user exactly what will happen (use the summary) and end your reply with: "Reply YES to confirm or NO to cancel."';

type WrappedExecute = (inputData: any, context: any) => Promise<any>;

/**
 * The chat-app equivalent of the web UI's confirmation cards.
 *
 * In the web UI outward tools (schedule, delete, reply, paid media jobs…) are
 * gated by CopilotKit cards. From Slack/Telegram/Discord/… there is no card,
 * so `access.mode === 'comms'` turns must not execute outward tools on the
 * model's say-so. This wrapper sits OUTSIDE the tool firewall: in comms mode
 * the first call of any non-read-only tool is parked (Redis, 15 min, one per
 * thread) and the model gets a summary to relay; the user's literal YES/NO is
 * handled in code by CommsInboundService, which re-invokes the parked call
 * through `executeConfirmed` with `access.confirmed` set. Every other mode
 * (user, mcp, headless) passes through untouched.
 */
@Injectable()
export class CommsConfirmationGate {
  static readonly TTL_SECONDS = 15 * 60;
  private readonly _logger = new Logger(CommsConfirmationGate.name);
  // toolId → fully wrapped execute (gate → firewall → Tool.execute), so a
  // confirmed run still goes through the firewall and schema validation.
  private readonly _registry = new Map<string, WrappedExecute>();

  constructor(private _redis: RedisService) {}

  static key(threadId: string): string {
    return `comms:pending:${threadId}`;
  }

  wrap<T extends { id?: string; mcp?: any; execute?: (...args: any[]) => any }>(
    name: string,
    tool: T,
  ): T {
    if (!tool || typeof tool.execute !== 'function') return tool;
    if (tool.mcp?.annotations?.readOnlyHint === true) return tool;

    const toolId = tool.id ?? name;
    const original = tool.execute.bind(tool) as WrappedExecute;
    const gated: WrappedExecute = async (inputData, context) => {
      const access = getAccess(context);
      if (access?.mode !== 'comms') {
        return original(inputData, context);
      }

      const threadId = context?.requestContext?.get?.('thread');
      if (!threadId) {
        // Fail closed: never run an outward tool in comms without a thread to
        // park against.
        this._logger.warn(`${toolId}: comms call without a thread in context — refused`);
        return { error: 'Confirmation gate: no thread in context' };
      }

      // The confirmed run: CommsInboundService has already consumed the Redis
      // record (so an Inngest retry can't run it twice) and executeConfirmed
      // carries the parked action in the call context. Both the access id
      // and the in-context action must agree — a model-initiated call never
      // has either.
      const confirmedAction = context?.confirmedAction as PendingAction | undefined;
      if (
        access.confirmed &&
        confirmedAction &&
        confirmedAction.confirmationId === access.confirmed &&
        confirmedAction.toolId === toolId
      ) {
        return original(inputData, context);
      }

      const pending = await this.getPending(threadId);

      // Same tool + same args as the parked action (the model retried) keeps
      // the id; anything else replaces the parked action for this thread.
      const sameCall =
        pending &&
        pending.toolId === toolId &&
        JSON.stringify(pending.args) === JSON.stringify(inputData);
      const confirmationId = sameCall
        ? pending!.confirmationId
        : randomBytes(6).toString('hex');
      const summary = summarizeToolCall(toolId, inputData);
      const now = Date.now();
      const action: PendingAction = {
        confirmationId,
        toolId,
        args: inputData,
        orgId: parseOrg(context).id,
        userId: parseUser(context).id,
        linkId: context?.requestContext?.get?.('linkId') ?? '',
        threadId,
        summary,
        createdAt: now,
        expiresAt: now + CommsConfirmationGate.TTL_SECONDS * 1000,
      };
      await this._redis.set(
        CommsConfirmationGate.key(threadId),
        JSON.stringify(action),
        CommsConfirmationGate.TTL_SECONDS,
      );
      this._logger.log(`${toolId}: parked for confirmation (thread=${threadId}, id=${confirmationId})`);
      const result: ParkedToolResult = {
        needsConfirmation: true,
        confirmationId,
        summary,
        instructions: PARKED_INSTRUCTIONS,
      };
      return result;
    };

    const wrapped = { ...tool, execute: gated } as T;
    this._registry.set(toolId, gated);
    return wrapped;
  }

  async getPending(threadId: string): Promise<PendingAction | null> {
    const raw = await this._redis.get(CommsConfirmationGate.key(threadId));
    if (!raw) return null;
    let action: PendingAction;
    try {
      action = JSON.parse(String(raw)) as PendingAction;
    } catch {
      await this.clearPending(threadId);
      return null;
    }
    // The in-memory Redis fallback ignores TTLs; enforce expiry here too.
    if (!action?.expiresAt || action.expiresAt <= Date.now()) {
      await this.clearPending(threadId);
      return null;
    }
    return action;
  }

  async clearPending(threadId: string): Promise<void> {
    await this._redis.del(CommsConfirmationGate.key(threadId));
  }

  /** Re-invoke a parked call through the full wrapped chain (gate → firewall → tool). */
  async executeConfirmed(pending: PendingAction, requestContext: unknown): Promise<unknown> {
    const execute = this._registry.get(pending.toolId);
    if (!execute) {
      throw new Error(`Confirmation gate: tool '${pending.toolId}' not registered`);
    }
    return execute(pending.args, { requestContext, confirmedAction: pending });
  }
}
