import { Injectable, Logger } from '@nestjs/common';
import { EmailLogRepository } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.repository';
import { type EmailStatus, type EmailWebhookEvent } from '@gitroom/nestjs-libraries/emails/email-adapter.interface';

const STATUS_PRECEDENCE: Record<EmailStatus, number> = {
  queued: 10,
  sent: 20,
  failed: 25,
  delivered: 30,
  opened: 35,
  clicked: 36,
  bounced: 100,
  complained: 100,
};

const TERMINAL_NEGATIVES: Set<EmailStatus> = new Set(['bounced', 'complained']);

@Injectable()
export class EmailLogService {
  private readonly _logger = new Logger(EmailLogService.name);

  constructor(private _repository: EmailLogRepository) {}

  async createLog(data: {
    provider: string;
    toAddress: string;
    fromAddress: string;
    subject: string;
    replyTo?: string;
    organizationId?: string;
  }) {
    return this._repository.create(data);
  }

  async markSent(id: string, providerMessageId: string, organizationId: string | null) {
    return this._repository.updateById(
      id,
      organizationId,
      {
        status: 'sent',
        providerMessageId,
      },
    );
  }

  async markFailed(id: string, error: string, organizationId: string | null) {
    const redacted = error.length > 500 ? error.slice(0, 500) + '...' : error;
    return this._repository.updateById(
      id,
      organizationId,
      { status: 'failed', error: redacted },
    );
  }

  async applyWebhookEvent(provider: string, event: EmailWebhookEvent) {
    if (!event.providerMessageId) return;

    const existing = await this._repository.findByMessageId(provider, event.providerMessageId);

    if (existing) {
      const existingRank = STATUS_PRECEDENCE[existing.status as EmailStatus] ?? -1;
      const incomingRank = STATUS_PRECEDENCE[event.status] ?? -1;

      if (TERMINAL_NEGATIVES.has(existing.status as EmailStatus)) return;

      if (incomingRank <= existingRank) return;

      await this._repository.applyStatus(
        existing.id,
        existing.organizationId ?? null,
        event.status,
        event.status === 'delivered' ? event.occurredAt : undefined,
      );
    } else {
      await this._repository.create({
        provider,
        toAddress: event.recipient || 'unknown',
        fromAddress: 'unknown',
        subject: '(webhook event)',
        providerMessageId: event.providerMessageId,
        status: event.status,
        deliveredAt: event.status === 'delivered' ? event.occurredAt : undefined,
      });
    }
  }

  async prune(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = await this._repository.deleteOlderThan(cutoff);
    this._logger.log(`Pruned ${result.count} email log rows older than ${days} days`);
    return result;
  }
}
