import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const safeFetchMock = vi.fn().mockResolvedValue({ status: 200 });
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => safeFetchMock(...args),
}));

import { WebhooksService } from './webhooks.service';
import { WebhooksRepository } from './webhooks.repository';
import { IntegrationRepository } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.repository';
import type { WebhooksDto } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhooks.dto';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let webhooksRepository: WebhooksRepository;
  let integrationRepository: IntegrationRepository;

  const orgId = 'org-a';

  const buildBody = (integrationIds: string[]): WebhooksDto => ({
    id: 'hook-1',
    name: 'My hook',
    url: 'https://example.com/hook',
    events: ['post.published'],
    integrations: integrationIds.map((id) => ({ id })),
  });

  const buildWebhook = (over: Partial<Record<string, any>> = {}) => ({
    id: 'hook-1',
    name: 'My hook',
    url: 'https://example.com/hook',
    events: [],
    integrations: [],
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    safeFetchMock.mockResolvedValue({ status: 200 });

    webhooksRepository = {
      getTotal: vi.fn(),
      getWebhooks: vi.fn().mockResolvedValue([]),
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

    it('passes the subscribed events through to the repository', async () => {
      const body = { ...buildBody([]), events: ['post.published', 'comment.new'] };

      await service.createWebhook(orgId, body);

      expect(webhooksRepository.createWebhook).toHaveBeenCalledWith(orgId, body);
    });
  });

  describe('dispatchEvent (event subscription filtering)', () => {
    it('delivers to a legacy webhook with an empty events list (receives all)', async () => {
      (webhooksRepository.getWebhooks as any).mockResolvedValue([
        buildWebhook({ events: [] }),
      ]);

      await service.dispatchEvent(orgId, 'comment.new', { postId: 'p1' });

      expect(safeFetchMock).toHaveBeenCalledTimes(1);
      expect(safeFetchMock).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ event: 'comment.new', postId: 'p1' }),
        })
      );
    });

    it('delivers to a webhook subscribed to the event', async () => {
      (webhooksRepository.getWebhooks as any).mockResolvedValue([
        buildWebhook({ events: ['analytics.anomaly_detected'] }),
      ]);

      await service.dispatchEvent(orgId, 'analytics.anomaly_detected', { orgId });

      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    });

    it('skips a webhook that is not subscribed to the event', async () => {
      (webhooksRepository.getWebhooks as any).mockResolvedValue([
        buildWebhook({ events: ['post.published'] }),
      ]);

      await service.dispatchEvent(orgId, 'comment.new', { postId: 'p1' });

      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it('delivers post.failed to subscribed webhooks', async () => {
      (webhooksRepository.getWebhooks as any).mockResolvedValue([
        buildWebhook({ events: ['post.failed'] }),
        buildWebhook({ id: 'hook-2', url: 'https://example.com/other', events: ['post.published'] }),
      ]);

      await service.dispatchEvent(orgId, 'post.failed', { postId: 'p1' });

      expect(safeFetchMock).toHaveBeenCalledTimes(1);
      expect(safeFetchMock.mock.calls[0][0]).toBe('https://example.com/hook');
    });

    it('keeps the integration scoping rule: scoped webhooks get no comment/analytics events even when subscribed', async () => {
      (webhooksRepository.getWebhooks as any).mockResolvedValue([
        buildWebhook({
          events: ['comment.new'],
          integrations: [{ id: 'int-own-1' }],
        }),
      ]);

      await service.dispatchEvent(orgId, 'comment.new', { postId: 'p1' });

      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it('swallows a failing delivery without rejecting', async () => {
      (webhooksRepository.getWebhooks as any).mockResolvedValue([
        buildWebhook({ events: [] }),
      ]);
      safeFetchMock.mockRejectedValue(new Error('boom'));

      await expect(
        service.dispatchEvent(orgId, 'comment.new', {})
      ).resolves.toBeUndefined();
    });
  });

  describe('getSupportedEventTypes', () => {
    it('exposes every dispatched event type', () => {
      expect(service.getSupportedEventTypes()).toEqual([
        'post.published',
        'post.failed',
        'comment.new',
        'comment.reply',
        'analytics.snapshot_complete',
        'analytics.anomaly_detected',
      ]);
    });
  });
});
