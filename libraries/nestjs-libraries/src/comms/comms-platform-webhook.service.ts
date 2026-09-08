import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CommsCapability } from '@postmill-ai/provider-kernel';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { CommsConfigRepository } from './comms-config.repository';
import { CommsLinkRepository } from './comms-link.repository';
import { CONNECT_CODE_PATTERN } from './comms-inbound.service';
import {
  getCommsPlatformCredentials,
  getTelegramPlatformWebhookSecret,
} from './comms-platform-env';

export interface PlatformWebhookEvent {
  name: 'comms/inbound.message';
  id: string;
  data: {
    configId: string;
    organizationId: string;
    identifier: string;
    externalUserId: string;
    externalChannelId?: string;
    text: string;
    messageId?: string;
  };
}

export interface PlatformWebhookResult {
  events: PlatformWebhookEvent[];
  ack?: unknown;
}

/**
 * Shared platform-app inbound handler (`POST /webhooks/comms/platform/:identifier`).
 * Unlike the per-org token route, the URL carries no routing secret: the
 * signature is verified with the deployment-env platform credentials and the
 * org is resolved per event (Slack team_id, Discord guild_id, Telegram/LINE
 * chat identity via the link tables). Mirrors the token route's discipline:
 * unknown provider/unconfigured platform → uniform 404, bad signature → 401,
 * challenge acks answered before any org resolution.
 */
@Injectable()
export class CommsPlatformWebhookService {
  private readonly _logger = new Logger(CommsPlatformWebhookService.name);

  constructor(
    private _configs: CommsConfigRepository,
    private _links: CommsLinkRepository,
    private _resolution: ProviderResolutionService,
  ) {}

  async handle(
    identifier: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<PlatformWebhookResult> {
    const credentials = getCommsPlatformCredentials(identifier);
    if (!credentials) {
      // Unknown provider or platform app not configured — no oracle.
      throw new NotFoundException();
    }
    // Telegram's platform webhook is registered with the derived secret, so
    // verify against it (the adapter compares it to the secret-token header).
    if (identifier === 'telegram') {
      credentials.webhookSecret = getTelegramPlatformWebhookSecret() || '';
    }

    let adapter: CommsCapability;
    try {
      adapter = this._resolution.resolveComms(identifier, {
        version: 'v1',
        credentials,
        orgId: 'platform',
      });
    } catch {
      throw new NotFoundException();
    }
    if (!adapter.verifyWebhook || !adapter.parseInbound) {
      throw new NotFoundException();
    }

    if (!(await adapter.verifyWebhook(rawBody, headers))) {
      throw new HttpException('invalid signature', 401);
    }

    const messages = adapter.parseInbound(rawBody, headers);

    // Slack url_verification / Discord PING happen before any org connects —
    // ack them without org resolution.
    const challenge = messages.find(
      (m) => m.kind === 'challenge' && m.ackResponse !== undefined,
    );
    if (challenge) {
      return { events: [], ack: challenge.ackResponse };
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      /* parseInbound already vetted the body; only org-resolution hints read this */
    }

    const events: PlatformWebhookEvent[] = [];
    for (const m of messages) {
      if (m.kind !== 'message' || !m.externalUserId || !m.text) continue;
      const config = await this._resolveConfig(identifier, payload, {
        externalUserId: m.externalUserId,
        text: m.text,
      });
      if (!config) {
        // Unresolvable sender (no link, unknown team/guild) — ack-ignore so
        // the provider stops retrying; nothing is enqueueable anyway.
        continue;
      }
      events.push({
        name: 'comms/inbound.message',
        id: `comms-inbound:${config.id}:${
          m.messageId ??
          createHash('sha256')
            .update(`${m.externalUserId}:${m.text}:${Date.now()}`)
            .digest('hex')
        }`,
        data: {
          configId: config.id,
          organizationId: config.organizationId,
          identifier,
          externalUserId: m.externalUserId,
          externalChannelId: m.externalChannelId,
          text: m.text,
          messageId: m.messageId,
        },
      });
    }

    const ack = messages.find((m) => m.ackResponse !== undefined)?.ackResponse;
    return { events, ack };
  }

  private async _resolveConfig(
    identifier: string,
    payload: any,
    message: { externalUserId: string; text: string },
  ) {
    if (identifier === 'slack') {
      const teamId = payload?.team_id;
      if (!teamId) return null;
      return this._configs.findByExtraConfigTeamId('slack', String(teamId));
    }
    if (identifier === 'discord' && payload?.guild_id) {
      return this._configs.findByGuildId('discord', String(payload.guild_id));
    }
    // Telegram/LINE (and guild-less Discord DM interactions): resolve through
    // the link tables — a linked chat identity first, then an unclaimed
    // connect code (the claim itself runs in the comms-inbound function).
    const linked = await this._links.findOrgByExternalUser(
      identifier,
      message.externalUserId,
    );
    if (linked?.config) return linked.config;
    const codeMatch = message.text.trim().match(CONNECT_CODE_PATTERN);
    if (codeMatch) {
      const pending = await this._links.findPendingByCode(
        identifier,
        codeMatch[1].toUpperCase(),
      );
      if (pending?.config) return pending.config;
    }
    return null;
  }
}
