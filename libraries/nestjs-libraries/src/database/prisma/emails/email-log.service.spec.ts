import { describe, it, expect, vi, beforeEach } from 'vitest';

const repoMock = {
  create: vi.fn(),
  findByMessageId: vi.fn(),
  updateById: vi.fn(),
  applyStatus: vi.fn(),
  deleteOlderThan: vi.fn(),
};

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/emails/email-log.repository',
  () => ({
    EmailLogRepository: vi.fn(() => repoMock),
  }),
);

import { EmailLogService } from './email-log.service';

describe('EmailLogService', () => {
  let service: EmailLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailLogService(repoMock as any);
  });

  describe('createLog', () => {
    it('delegates to repository.create', async () => {
      const data = {
        provider: 'resend',
        toAddress: 'to@example.com',
        fromAddress: 'from@example.com',
        subject: 'Welcome',
        replyTo: 'reply@example.com',
        organizationId: 'org-1',
      };
      const created = { id: 'log-1', ...data };
      repoMock.create.mockResolvedValue(created);

      const result = await service.createLog(data);

      expect(repoMock.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });
  });

  describe('markSent', () => {
    it('delegates to repository.updateById with status sent', async () => {
      const updated = { id: 'log-1', status: 'sent', providerMessageId: 'msg-1' };
      repoMock.updateById.mockResolvedValue(updated);

      const result = await service.markSent('log-1', 'msg-1', null);

      expect(repoMock.updateById).toHaveBeenCalledWith('log-1', null, {
        status: 'sent',
        providerMessageId: 'msg-1',
      });
      expect(result).toEqual(updated);
    });

    it('passes organizationId when supplied', async () => {
      repoMock.updateById.mockResolvedValue({ id: 'log-1', status: 'sent' });

      await service.markSent('log-1', 'msg-1', 'org-1');

      expect(repoMock.updateById).toHaveBeenCalledWith(
        'log-1',
        'org-1',
        { status: 'sent', providerMessageId: 'msg-1' },
      );
    });
  });

  describe('markFailed', () => {
    it('delegates to repository.updateById with status failed', async () => {
      const error = 'SMTP 550: mailbox not found';
      repoMock.updateById.mockResolvedValue({ id: 'log-1', status: 'failed', error });

      const result = await service.markFailed('log-1', error, null);

      expect(repoMock.updateById).toHaveBeenCalledWith('log-1', null, {
        status: 'failed',
        error,
      });
      expect(result.status).toBe('failed');
    });

    it('redacts errors longer than 500 characters', async () => {
      const longError = 'E'.repeat(600);
      const expectedRedacted = 'E'.repeat(500) + '...';
      repoMock.updateById.mockResolvedValue({ id: 'log-1', status: 'failed', error: expectedRedacted });

      await service.markFailed('log-1', longError, null);

      expect(repoMock.updateById).toHaveBeenCalledWith('log-1', null, {
        status: 'failed',
        error: expectedRedacted,
      });
    });

    it('does not redact errors with exactly 500 characters', async () => {
      const exactError = 'X'.repeat(500);
      repoMock.updateById.mockResolvedValue({ id: 'log-1', status: 'failed', error: exactError });

      await service.markFailed('log-1', exactError, null);

      expect(repoMock.updateById).toHaveBeenCalledWith('log-1', null, {
        status: 'failed',
        error: exactError,
      });
    });

    it('does not redact errors shorter than 500 characters', async () => {
      const shortError = 'Short error message';
      repoMock.updateById.mockResolvedValue({ id: 'log-1', status: 'failed', error: shortError });

      await service.markFailed('log-1', shortError, null);

      expect(repoMock.updateById).toHaveBeenCalledWith('log-1', null, {
        status: 'failed',
        error: shortError,
      });
    });

    it('passes organizationId when supplied', async () => {
      repoMock.updateById.mockResolvedValue({ id: 'log-1', status: 'failed', error: 'x' });

      await service.markFailed('log-1', 'x', 'org-1');

      expect(repoMock.updateById).toHaveBeenCalledWith(
        'log-1',
        'org-1',
        { status: 'failed', error: 'x' },
      );
    });
  });

  describe('applyWebhookEvent', () => {
    const provider = 'resend';
    const occurredAt = new Date('2024-06-15T10:00:00Z');

    it('returns early if no providerMessageId', async () => {
      const event = {
        status: 'delivered' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event as any);

      expect(repoMock.findByMessageId).not.toHaveBeenCalled();
      expect(repoMock.create).not.toHaveBeenCalled();
    });

    it('creates new row when no existing row found', async () => {
      repoMock.findByMessageId.mockResolvedValue(null);
      const event = {
        providerMessageId: 'msg-new',
        recipient: 'to@example.com',
        status: 'sent' as const,
        occurredAt,
      };
      const created = {
        id: 'new-log',
        provider: 'resend',
        toAddress: 'to@example.com',
        fromAddress: 'unknown',
        subject: '(webhook event)',
        providerMessageId: 'msg-new',
        status: 'sent',
      };
      repoMock.create.mockResolvedValue(created);

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.findByMessageId).toHaveBeenCalledWith(provider, 'msg-new');
      expect(repoMock.create).toHaveBeenCalledWith({
        provider,
        toAddress: 'to@example.com',
        fromAddress: 'unknown',
        subject: '(webhook event)',
        providerMessageId: 'msg-new',
        status: 'sent',
        deliveredAt: undefined,
      });
    });

    it('uses "unknown" recipient when event.recipient is missing', async () => {
      repoMock.findByMessageId.mockResolvedValue(null);
      const event = {
        providerMessageId: 'msg-no-recipient',
        status: 'sent' as const,
        occurredAt,
      };
      repoMock.create.mockResolvedValue({ id: 'log-1' });

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ toAddress: 'unknown' }),
      );
    });

    it('sets deliveredAt when new row status is delivered', async () => {
      repoMock.findByMessageId.mockResolvedValue(null);
      const event = {
        providerMessageId: 'msg-delivered',
        recipient: 'to@example.com',
        status: 'delivered' as const,
        occurredAt,
      };
      repoMock.create.mockResolvedValue({ id: 'log-1' });

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'delivered',
          deliveredAt: occurredAt,
        }),
      );
    });

    it('upgrades status when incoming has higher precedence (sent → delivered)', async () => {
      const existing = { id: 'log-1', status: 'sent', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'delivered' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).toHaveBeenCalledWith('log-1', null, 'delivered', occurredAt);
    });

    it('does NOT downgrade status (delivered → sent is no-op)', async () => {
      const existing = { id: 'log-1', status: 'delivered', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'sent' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).not.toHaveBeenCalled();
    });

    it('does not replay a status equal to the current one', async () => {
      const existing = { id: 'log-1', status: 'clicked', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'clicked' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).not.toHaveBeenCalled();
    });

    it('sets deliveredAt when upgrading an existing row to delivered', async () => {
      const existing = { id: 'log-1', status: 'sent', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'delivered' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).toHaveBeenCalledWith('log-1', null, 'delivered', occurredAt);
    });

    it('upgrades from queued → sent', async () => {
      const existing = { id: 'log-1', status: 'queued', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'sent' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).toHaveBeenCalledWith('log-1', null, 'sent', undefined);
    });

    it('does NOT upgrade past a terminal negative — bounced row ignores delivered', async () => {
      const existing = { id: 'log-1', status: 'bounced', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'delivered' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).not.toHaveBeenCalled();
    });

    it('does NOT upgrade past a terminal negative — complained row ignores opened', async () => {
      const existing = { id: 'log-1', status: 'complained', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'opened' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).not.toHaveBeenCalled();
    });

    it('terminal negatives always upgrade over non-terminal (sent → bounced is applied)', async () => {
      const existing = { id: 'log-1', status: 'sent', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'bounced' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).toHaveBeenCalledWith('log-1', null, 'bounced', undefined);
    });

    it('terminal negatives always upgrade over non-terminal (delivered → complained is applied)', async () => {
      const existing = { id: 'log-1', status: 'delivered', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'complained' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).toHaveBeenCalledWith('log-1', null, 'complained', undefined);
    });

    it('applies status for unknown existing status (existing status not in STATUS_PRECEDENCE)', async () => {
      const existing = { id: 'log-1', status: 'unknown-status', providerMessageId: 'msg-1' };
      repoMock.findByMessageId.mockResolvedValue(existing);
      const event = {
        providerMessageId: 'msg-1',
        status: 'sent' as const,
        occurredAt,
      };

      await service.applyWebhookEvent(provider, event);

      expect(repoMock.applyStatus).toHaveBeenCalledWith('log-1', null, 'sent', undefined);
    });
  });

  describe('prune', () => {
    it('calculates cutoff date correctly and delegates to repository.deleteOlderThan', async () => {
      const before = Date.now();
      const deleteResult = { count: 42 };
      repoMock.deleteOlderThan.mockResolvedValue(deleteResult);

      const result = await service.prune(30);

      const after = Date.now();

      expect(repoMock.deleteOlderThan).toHaveBeenCalledTimes(1);

      const cutoffArg = repoMock.deleteOlderThan.mock.calls[0][0] as Date;
      const cutoffTime = cutoffArg.getTime();
      const expectedCutoff = before - 30 * 24 * 60 * 60 * 1000;

      // Allow some tolerance for test execution time
      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoff - 5000);
      expect(cutoffTime).toBeLessThanOrEqual(after);

      expect(result).toEqual(deleteResult);
    });
  });
});
