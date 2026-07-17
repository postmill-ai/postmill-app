import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

const SUPPORTED_EVENT_TYPES = [
  'post.published',
  'comment.new',
  'comment.reply',
  'analytics.snapshot_complete',
] as const;

export type WebhookEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

@Injectable()
export class WebhooksService {
  private readonly _logger = new Logger(WebhooksService.name);

  constructor(
    private _webhooksRepository: WebhooksRepository,
    // layering: sanctioned leaf-read of IntegrationRepository (ownership check needs
    // only the org's integration ids — getIntegrationIds is id-only, no token decrypt)
    private _integrationRepository: IntegrationRepository,
  ) {}

  getSupportedEventTypes(): string[] {
    return [...SUPPORTED_EVENT_TYPES];
  }

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  getWebhooks(orgId: string) {
    return this._webhooksRepository.getWebhooks(orgId);
  }

  // Single insertion point for both POST /webhooks and PUT /webhooks (the controller
  // method named updateWebhook routes here too) — reject foreign-org integrations
  // before any write reaches the repository. Empty integrations (unscoped) is valid.
  async createWebhook(orgId: string, body: WebhooksDto) {
    const owned = new Set(await this._integrationRepository.getIntegrationIds(orgId));
    if (body.integrations.some((i) => !owned.has(i.id))) {
      throw new BadRequestException('Unknown integration');
    }
    return this._webhooksRepository.createWebhook(orgId, body);
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooksRepository.deleteWebhook(orgId, id);
  }

  async dispatchEvent(orgId: string, eventType: string, payload: Record<string, any>): Promise<void> {
    const webhooks = (await this._webhooksRepository.getWebhooks(orgId)).filter(
      (w) => w.integrations.length === 0 || eventType === 'post.published'
    );

    if (!webhooks.length) return;

    await Promise.allSettled(
      webhooks.map(async (webhook) => {
        try {
          await safeFetch(webhook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: eventType, ...payload }),
          });
        } catch (err) {
          this._logger.warn(`Webhook dispatch failed for ${webhook.url}: ${(err as Error)?.message}`);
        }
      })
    );
  }
}
