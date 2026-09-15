import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { CommsConfigRepository } from './comms-config.repository';
import { CommsConfigService } from './comms-config.service';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsLinkService } from './comms-link.service';
import { CommsAgentActivity } from './comms-agent.activity';
import { CommsConfirmationGate } from '@postmill-ai/nestjs-libraries/chat/tools/comms-confirmation.gate';

export interface CommsInboundEvent {
  configId: string;
  organizationId: string;
  identifier: string;
  externalUserId: string;
  externalChannelId?: string;
  text: string;
  messageId?: string;
}

// "ABCD2345", "link ABCD2345", "/postmill link ABCD2345" — the connect-code
// alphabet has no 0/O/1/I/L. Shared with the platform webhook route, which
// resolves the org for a code claim before enqueueing.
export const CONNECT_CODE_PATTERN =
  /^\/?(?:postmill\s+)?(?:link\s+)?([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8})$/i;

// A message from an UNLINKED sender that looks like a botched link attempt —
// the word "link"/"postmill", or a code-shaped token (8 chars of the
// connect-code alphabet) that contains at least one digit, so ordinary
// 8-letter words ("thursday", "whatever") don't qualify. Only these get a
// fixed hint reply; everything else from unknown senders stays silent (see
// _handleMessage).
const LINK_ATTEMPT_PATTERN =
  /\b(?:link|postmill)\b|\b(?=[ABCDEFGHJKMNPQRSTUVWXYZ23456789]*\d)[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}\b/i;

const DISABLED_REPLY =
  'Agent chat is disabled for your account. An admin can enable it under Settings → Comms.';

// The chat-app confirmation contract: an outward action parked by the
// CommsConfirmationGate is executed or dropped on the user's literal answer,
// decided here in code — never by the model.
const YES_PATTERN = /^(yes|y|yep|yeah|confirm|approve|ok|okay|go|do it)\b/i;
const NO_PATTERN = /^(no|n|nope|cancel|stop|abort)\b/i;
const CONFIRM_PROMPT = 'Reply YES to confirm or NO to cancel.';

const LINK_HINT_REPLY =
  "That doesn't look like a valid connect code. Send exactly `link ABCD2345` (the 8-character code from Settings → Comms → your provider → Add link) as a plain message — no @mention or extra words. Codes expire 15 minutes after they are issued.";

@Injectable()
export class CommsInboundService {
  private readonly _logger = new Logger(CommsInboundService.name);

  constructor(
    private _configs: CommsConfigRepository,
    private _configService: CommsConfigService,
    private _links: CommsLinkRepository,
    private _linkService: CommsLinkService,
    private _agentActivity: CommsAgentActivity,
    private _notificationService: NotificationService,
    private _gate: CommsConfirmationGate,
  ) {}

  // Matrix cron support: enabled poll-inbound configs to fan out over.
  listPollConfigs(identifier: string) {
    return this._configs.getEnabledByIdentifier(identifier);
  }

  /**
   * One /sync round for a matrix config: poll from the stored cursor, persist
   * the new cursor, return the inbound messages for the caller to enqueue.
   */
  async pollConfig(orgId: string, configId: string, identifier: string) {
    const adapter = await this._configService.resolveAdapter(orgId, identifier);
    if (!adapter.pollInbound) return { messages: [] };
    const config = await this._configs.getById(configId);
    if (!config || config.organizationId !== orgId) return { messages: [] };
    const result = await adapter.pollInbound(config.syncCursor ?? undefined);
    if (result.nextCursor && result.nextCursor !== config.syncCursor) {
      await this._configs.updateSyncCursor(configId, result.nextCursor);
    }
    return {
      messages: result.messages.filter(
        (m) => m.kind === 'message' && m.externalUserId && m.text,
      ),
    };
  }

  /**
   * Process one inbound message: connect-code claim, or an agent turn for a
   * linked user. Runs inside the comms-inbound Inngest function. Every path
   * resolves — replies are best-effort and never throw upstream.
   */
  async process(event: CommsInboundEvent): Promise<{ handled: string }> {
    const { organizationId, identifier, externalUserId } = event;

    const trimmed = (event.text || '').trim();
    const codeMatch = trimmed.match(CONNECT_CODE_PATTERN);
    const result = codeMatch
      ? await this._handleClaim(event, codeMatch[1])
      : await this._handleMessage(event, trimmed);
    this._logger.log(
      `comms inbound ${identifier} org=${organizationId} user=${externalUserId} → ${result.handled}`,
    );
    return result;
  }

  private async _handleMessage(
    event: CommsInboundEvent,
    trimmed: string,
  ): Promise<{ handled: string }> {
    const { configId, organizationId, identifier, externalUserId } = event;

    const link = await this._links.getByExternalUser(configId, externalUserId);
    if (!link) {
      // Unknown senders are silently ignored — a reply would let anyone who
      // finds the bot probe it (and spam our API quota). The one exception is
      // a message that looks like a mangled link attempt (an @mention prefix,
      // extra words, a stale code): that is a real user stuck with no feedback,
      // and the fixed hint reveals nothing.
      if (LINK_ATTEMPT_PATTERN.test(trimmed)) {
        await this._reply(event, LINK_HINT_REPLY);
        return { handled: 'link_hint_unknown_sender' };
      }
      return { handled: 'ignored_unknown_sender' };
    }

    if (
      event.externalChannelId &&
      event.externalChannelId !== link.externalChannelId
    ) {
      await this._links.setExternalChannelId(link.id, event.externalChannelId);
    }

    if (!link.agentChatEnabled) {
      await this._reply(event, DISABLED_REPLY);
      return { handled: 'agent_disabled' };
    }

    const externalThreadKey = event.externalChannelId ?? externalUserId;
    const threadId = this._agentActivity.threadId(link.id, externalThreadKey);
    const pending = await this._gate.getPending(threadId);
    if (pending) {
      if (YES_PATTERN.test(trimmed)) {
        // Consume BEFORE executing: an Inngest retry of this event must never
        // run the action twice.
        await this._gate.clearPending(threadId);
        const outcome = await this._agentActivity.runConfirmedAction({
          orgId: organizationId,
          userId: link.userId,
          linkId: link.id,
          threadId,
          pending,
        });
        const outcomeText = outcome.ok
          ? this._summarizeResult(pending.toolId, outcome.result)
          : `Sorry — that didn't go through: ${outcome.error}.`;
        await this._reply(event, outcomeText);
        await this._agentActivity.recordExchange({
          orgId: organizationId,
          threadId,
          userText: trimmed,
          assistantText: `[Confirmed: ${pending.summary}] ${outcomeText}`,
        });
        return { handled: outcome.ok ? 'confirmed_action' : 'confirmed_action_failed' };
      }
      if (NO_PATTERN.test(trimmed)) {
        await this._gate.clearPending(threadId);
        const cancelText = 'Cancelled — nothing was done.';
        await this._reply(event, cancelText);
        await this._agentActivity.recordExchange({
          orgId: organizationId,
          threadId,
          userText: trimmed,
          assistantText: `[Cancelled: ${pending.summary}] ${cancelText} No action is pending now.`,
        });
        return { handled: 'cancelled_action' };
      }
      // Anything else: the parked action stays until it expires, and the
      // model is told a confirmation is pending (activity puts it in context).
    }

    const reply = await this._agentActivity.generateReply({
      orgId: organizationId,
      userId: link.userId,
      linkId: link.id,
      externalThreadKey,
      text: trimmed,
    });
    let replyText = reply.text;
    if (reply.pendingConfirmation) {
      // The user must see exactly what will run, not the model's paraphrase
      // (small models skip or reword it). Strip the model's own YES/NO
      // sentence, then append the parked summary + the canonical prompt.
      replyText = replyText.replace(/\s*(please\s+)?reply\s+yes\s+to\s+confirm[^.!\n]*[.!]?/gi, '').trim();
      replyText = `${replyText}\n\nAction: ${reply.pendingConfirmation.summary}\n${CONFIRM_PROMPT}`;
    }
    await this._reply(event, replyText);
    return { handled: 'agent_reply' };
  }

  /** Short, tool-specific outcome line for a confirmed action. */
  private _summarizeResult(toolId: string, result: unknown): string {
    const r = (result ?? {}) as Record<string, any>;
    const failure = r.error || r.errors;
    if (failure) {
      return `Not done — ${typeof failure === 'string' ? failure : JSON.stringify(failure).slice(0, 300)}`;
    }
    switch (toolId) {
      case 'schedulePostTool': {
        const created = Array.isArray(r.output) ? r.output.length : 0;
        return created
          ? `Done — ${created} post(s) created.`
          : 'Done — the post was submitted.';
      }
      case 'deletePost':
        return 'Deleted.';
      case 'approveDraft':
        return 'Approved.';
      case 'reschedulePost':
        return 'Rescheduled.';
      case 'commentReply':
        return `Reply posted${r.platformCommentId ? ` (${r.platformCommentId})` : ''}.`;
      case 'mediaStudioGenerate':
        return r.jobId
          ? `Media job ${r.jobId} started — ask me "is my media job done?" to check on it.`
          : 'Media job started.';
      case 'generateImageTool':
      case 'generateVideoTool':
        return `Done${r.path ? ` — ${r.path}` : r.id ? ` — file ${r.id}` : ''}.`;
      case 'uploadFromUrlTool':
        return `Uploaded${r.path ? ` — ${r.path}` : ''}.`;
      case 'campaignCreate':
        return `Campaign created${r.id ? ` (${r.id})` : ''}.`;
      case 'campaignUpdate':
      case 'campaignTag':
        return 'Campaign updated.';
      case 'brandMemoryReindex':
        return 'Brand memory reindex started.';
      default:
        return 'Done.';
    }
  }

  private async _handleClaim(
    event: CommsInboundEvent,
    code: string,
  ): Promise<{ handled: string }> {
    const adapter = await this._configService.resolveAdapter(
      event.organizationId,
      event.identifier,
    );
    const identity: { displayName?: string } =
      (await adapter.fetchIdentity?.(event.externalUserId).catch(() => ({}))) ?? {};
    const link = await this._linkService.claimCode(event.configId, code, {
      externalUserId: event.externalUserId,
      externalDisplayName: identity?.displayName,
      externalChannelId: event.externalChannelId,
    });
    if (!link) {
      await this._reply(event, 'That connect code is invalid or has expired. Ask your admin for a new one.');
      return { handled: 'claim_failed' };
    }

    await this._reply(
      event,
      "✅ You're linked! You can now chat with your Postmill agent here and receive your notifications.",
    );
    // Surface the claim to the linked Postmill user so a mis-delivered code is
    // noticed (in-app; comms delivery would just echo into the same chat).
    try {
      await this._notificationService.notify({
        orgId: event.organizationId,
        category: 'channels',
        title: 'Comms account linked',
        message: `Your ${event.identifier} account${identity?.displayName ? ` (${identity.displayName})` : ''} was linked for agent chat and notifications.`,
        targetUserIds: [link.userId],
        channels: { comms: false },
      });
    } catch (err) {
      this._logger.warn(
        `Link-claimed notification failed (org=${event.organizationId}): ${(err as Error).message}`,
      );
    }
    return { handled: 'claimed' };
  }

  private async _reply(event: CommsInboundEvent, text: string): Promise<void> {
    try {
      const adapter = await this._configService.resolveAdapter(
        event.organizationId,
        event.identifier,
      );
      await adapter.sendDirectMessage({
        externalUserId: event.externalUserId,
        externalChannelId: event.externalChannelId,
        text,
      });
    } catch (err) {
      this._logger.warn(
        `Comms reply failed (org=${event.organizationId}, provider=${event.identifier}): ${(err as Error).message}`,
      );
    }
  }
}
