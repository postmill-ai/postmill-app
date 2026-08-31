import { Injectable, Logger } from '@nestjs/common';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsConfigService } from './comms-config.service';

export interface CommsDeliveryPayload {
  title: string;
  message: string;
  link?: string;
}

/**
 * Delivers notifications to linked comms apps (Slack/Telegram/... DMs).
 * NotificationService's 4th delivery bucket. Depends only on the comms
 * repositories/services — never on NotificationService — so injecting it there
 * creates no DI cycle. Delivery failures are logged (redacted) and swallowed:
 * a dead bot must never fail notify().
 */
@Injectable()
export class CommsDeliveryService {
  private readonly _logger = new Logger(CommsDeliveryService.name);

  constructor(
    private _links: CommsLinkRepository,
    private _configService: CommsConfigService,
  ) {}

  async sendToUsers(
    orgId: string,
    userIds: string[],
    category: string,
    payload: CommsDeliveryPayload,
    override = false,
  ): Promise<void> {
    if (!userIds.length) return;
    let rows;
    try {
      rows = await this._links.getLinkedForUsers(orgId, userIds);
    } catch (err) {
      this._logger.warn(`Comms link lookup failed (org=${orgId}): ${(err as Error).message}`);
      return;
    }

    const targets = rows.filter((row) => {
      if (override) return true;
      const categories = (row.categories ?? {}) as Record<string, boolean>;
      return categories[category] === true;
    });
    if (!targets.length) return;

    // One adapter per config, reused across its users.
    const adapters = new Map<string, Awaited<ReturnType<CommsConfigService['resolveAdapter']>>>();
    const text = payload.message ? `*${payload.title}*\n${payload.message}` : payload.title;

    for (const row of targets) {
      if (!row.externalUserId) continue;
      try {
        let adapter = adapters.get(row.configId);
        if (!adapter) {
          adapter = await this._configService.resolveAdapter(orgId, row.config.identifier);
          adapters.set(row.configId, adapter);
        }
        const result = await adapter.sendDirectMessage({
          externalUserId: row.externalUserId,
          externalChannelId: row.externalChannelId ?? undefined,
          text,
          link: payload.link,
        });
        if (result.externalChannelId && result.externalChannelId !== row.externalChannelId) {
          await this._links.setExternalChannelId(row.id, result.externalChannelId);
        }
      } catch (err) {
        // Redacted: provider + org only — never tokens or message bodies.
        this._logger.warn(
          `Comms delivery failed (org=${orgId}, provider=${row.config.identifier}, category=${category}): ${(err as Error).message}`,
        );
      }
    }
  }
}
