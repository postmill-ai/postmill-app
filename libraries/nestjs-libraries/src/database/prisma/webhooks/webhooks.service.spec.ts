import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksRepository } from './webhooks.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import type { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let webhooksRepository: WebhooksRepository;
  let integrationRepository: IntegrationRepository;

  const orgId = 'org-a';

  const buildBody = (integrationIds: string[]): WebhooksDto => ({
    id: 'hook-1',
    name: 'My hook',
    url: 'https://example.com/hook',
    integrations: integrationIds.map((id) => ({ id })),
  });

  beforeEach(() => {
    webhooksRepository = {
      getTotal: vi.fn(),
      getWebhooks: vi.fn(),
      createWebhook: vi.fn().mockResolvedValue({ id: 'hook-1' }),
      deleteWebhook: vi.fn(),
    } as any;

    integrationRepository = {
      getIntegrationIds: vi.fn().mockResolvedValue(['int-own-1', 'int-own-2']),
    } as any;

    service = new WebhooksService(
      webhooksRepository as WebhooksRepository,
      integrationRepository as IntegrationRepository,
    );
  });

  // F6: createWebhook is the single insertion point — the PUT controller method
  // named updateWebhook (webhooks.controller.ts:45) also routes through it.
  describe('createWebhook (F6 — foreign-org integration guard)', () => {
    it('rejects with 400 when the body links an integration owned by another org', async () => {
      // Org B's integration id is not in org A's owned id set.
      const body = buildBody(['int-org-b']);

      const err = await service.createWebhook(orgId, body).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getStatus()).toBe(400);
      expect((err as Error).message).toBe('Unknown integration');
      expect(integrationRepository.getIntegrationIds).toHaveBeenCalledWith(orgId);
      // The rejection happens BEFORE any write reaches the repository.
      expect(webhooksRepository.createWebhook).not.toHaveBeenCalled();
    });

    it('rejects when any one of several integrations is foreign', async () => {
      const body = buildBody(['int-own-1', 'int-org-b']);

      await expect(service.createWebhook(orgId, body)).rejects.toThrow('Unknown integration');
      expect(webhooksRepository.createWebhook).not.toHaveBeenCalled();
    });

    it('accepts a webhook scoped to the org\'s own integrations', async () => {
      const body = buildBody(['int-own-1', 'int-own-2']);

      const result = await service.createWebhook(orgId, body);

      expect(result).toEqual({ id: 'hook-1' });
      expect(webhooksRepository.createWebhook).toHaveBeenCalledWith(orgId, body);
    });

    it('accepts an empty integrations array (unscoped webhook)', async () => {
      const body = buildBody([]);

      const result = await service.createWebhook(orgId, body);

      expect(result).toEqual({ id: 'hook-1' });
      expect(webhooksRepository.createWebhook).toHaveBeenCalledWith(orgId, body);
    });
  });
});
