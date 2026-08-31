import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { CommsConfigRepository } from './comms-config.repository';
import { CommsConfigService } from './comms-config.service';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsLinkService } from './comms-link.service';
import { CommsAgentActivity } from './comms-agent.activity';

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
// alphabet has no 0/O/1/I/L.
const CONNECT_CODE_PATTERN =
  /^\/?(?:postmill\s+)?(?:link\s+)?([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8})$/i;

const DISABLED_REPLY =
  'Agent chat is disabled for your account. An admin can enable it under Settings → Comms.';

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
    const { configId, organizationId, identifier, externalUserId, text } = event;

    const trimmed = (text || '').trim();
    const codeMatch = trimmed.match(CONNECT_CODE_PATTERN);
    if (codeMatch) {
      return this._handleClaim(event, codeMatch[1]);
    }

    const link = await this._links.getByExternalUser(configId, externalUserId);
    if (!link) {
      // Unknown senders are silently ignored — a reply would let anyone who
      // finds the bot probe it (and spam our API quota).
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

    const { text: replyText } = await this._agentActivity.generateReply({
      orgId: organizationId,
      userId: link.userId,
      linkId: link.id,
      externalThreadKey: event.externalChannelId ?? externalUserId,
      text: trimmed,
    });
    await this._reply(event, replyText);
    return { handled: 'agent_reply' };
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
