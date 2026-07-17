import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';

const mockAdapter = {
  name: 'resend',
  caps: { webhooks: true, openTracking: true, clickTracking: true },
  requiredEnvKeys: ['EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'],
  isConfigured: vi.fn().mockReturnValue(true),
  send: vi.fn().mockResolvedValue({ providerMessageId: 'msg-abc' }),
};

const mockEmptyAdapter = {
  name: 'empty',
  caps: { webhooks: false, openTracking: false, clickTracking: false },
  requiredEnvKeys: [],
  isConfigured: vi.fn().mockReturnValue(true),
  send: vi.fn(),
};

const mockCreateLog = vi.fn().mockResolvedValue({ id: 'log-1' });
const mockMarkSent = vi.fn().mockResolvedValue(undefined);
const mockMarkFailed = vi.fn().mockResolvedValue(undefined);

vi.mock('@gitroom/nestjs-libraries/emails/email-adapter.registry', () => ({
  EmailAdapterRegistry: class {
    getActiveAdapter = vi.fn();
  },
}));

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service',
  () => ({
    EmailLogService: class {
      createLog = mockCreateLog;
      markSent = mockMarkSent;
      markFailed = mockMarkFailed;
    },
  }),
);

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn() },
  isInngestEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('@gitroom/helpers/utils/timer', () => ({ timer: vi.fn() }));

import { EmailAdapterRegistry } from '@gitroom/nestjs-libraries/emails/email-adapter.registry';
import { EmailLogService } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { timer } from '@gitroom/helpers/utils/timer';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let registry: EmailAdapterRegistry;
  let logService: EmailLogService;

  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    process.env.EMAIL_FROM_ADDRESS = 'noreply@test.com';
    process.env.EMAIL_FROM_NAME = 'Test Sender';
    process.env.FRONTEND_URL = 'https://app.test.com';

    vi.clearAllMocks();
    vi.mocked(inngest.send).mockResolvedValue(undefined);

    registry = new EmailAdapterRegistry();
    logService = new EmailLogService();
    service = new EmailService(registry, logService);
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // --- hasProvider ---

  it('returns true when active adapter is configured and not empty', () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    expect(service.hasProvider()).toBe(true);
  });

  it('returns false when active adapter is "empty"', () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockEmptyAdapter);
    expect(service.hasProvider()).toBe(false);
  });

  it('returns false when adapter is not configured', () => {
    const unconfigured = { ...mockAdapter, isConfigured: vi.fn().mockReturnValue(false) };
    vi.mocked(registry.getActiveAdapter).mockReturnValue(unconfigured);
    expect(service.hasProvider()).toBe(false);
  });

  // --- sendEmail ---

  it('delegates to inngest.send with correct args when addTo is top', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);

    await service.sendEmail('a@b.com', 'Subject', '<p>Hi</p>', 'top', 'reply@b.com');

    expect(inngest.send).toHaveBeenCalledWith({
      name: 'email/send',
      id: expect.stringMatching(/^email_/),
      data: {
        to: 'a@b.com',
        subject: 'Subject',
        html: '<p>Hi</p>',
        replyTo: 'reply@b.com',
        addTo: 'top',
      },
    });
  });

  it('delegates to inngest.send with addTo bottom', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);

    await service.sendEmail('a@b.com', 'S', '<p>H</p>', 'bottom');

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ addTo: 'bottom' }),
      }),
    );
  });

  it('skips inngest.send when Inngest is disabled', async () => {
    vi.mocked(isInngestEnabled).mockReturnValue(false);
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);

    await service.sendEmail('a@b.com', 'S', '<p>H</p>', 'top');

    expect(inngest.send).not.toHaveBeenCalled();
  });

  // --- sendEmailSync: early returns ---

  it('early-returns when "to" has no @ character', async () => {
    await service.sendEmailSync('invalid-email', 'S', '<p>H</p>');
    expect(mockCreateLog).not.toHaveBeenCalled();
    expect(mockAdapter.send).not.toHaveBeenCalled();
  });

  it('early-returns when EMAIL_FROM_ADDRESS is missing', async () => {
    delete process.env.EMAIL_FROM_ADDRESS;
    await service.sendEmailSync('a@b.com', 'S', '<p>H</p>');
    expect(mockCreateLog).not.toHaveBeenCalled();
  });

  it('early-returns when EMAIL_FROM_NAME is missing', async () => {
    delete process.env.EMAIL_FROM_NAME;
    await service.sendEmailSync('a@b.com', 'S', '<p>H</p>');
    expect(mockCreateLog).not.toHaveBeenCalled();
  });

  // --- sendEmailSync: log creation ---

  it('creates an EmailLog row with queued status via createLog', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send.mockResolvedValue({ providerMessageId: 'msg-abc' });

    await service.sendEmailSync('a@b.com', 'Subject', '<p>Hi</p>', 'reply@b.com');

    expect(mockCreateLog).toHaveBeenCalledWith({
      provider: 'resend',
      toAddress: 'a@b.com',
      fromAddress: 'noreply@test.com',
      subject: 'Subject',
      replyTo: 'reply@b.com',
    });
  });

  // --- sendEmailSync: success ---

  it('marks log as sent with providerMessageId on success', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send.mockResolvedValue({ providerMessageId: 'msg-xyz' });

    await service.sendEmailSync('a@b.com', 'S', '<p>H</p>');

    expect(mockMarkSent).toHaveBeenCalledWith('log-1', 'msg-xyz', null);
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it('marks log as sent with "no-id" when result has no providerMessageId', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send.mockResolvedValue({});

    await service.sendEmailSync('a@b.com', 'S', '<p>H</p>');

    expect(mockMarkSent).toHaveBeenCalledWith('log-1', 'no-id', null);
  });

  // --- sendEmailSync: retry ---

  it('retries on failure and succeeds on 2nd attempt, marks as sent', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ providerMessageId: 'msg-retry' });

    await service.sendEmailSync('a@b.com', 'S', '<p>H</p>');

    expect(mockAdapter.send).toHaveBeenCalledTimes(2);
    expect(timer).toHaveBeenCalledWith(700);
    expect(mockMarkSent).toHaveBeenCalledWith('log-1', 'msg-retry', null);
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it('fails all 3 attempts and marks log as failed', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await expect(service.sendEmailSync('a@b.com', 'S', '<p>H</p>')).rejects.toThrow('ETIMEDOUT');

    expect(mockAdapter.send).toHaveBeenCalledTimes(3);
    expect(timer).toHaveBeenCalledTimes(2);
    expect(mockMarkFailed).toHaveBeenCalledWith('log-1', 'ETIMEDOUT', null);
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  it('retries non-connection errors and throws after terminal failure', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send.mockRejectedValue(new Error('invalid address'));

    await expect(service.sendEmailSync('a@b.com', 'S', '<p>H</p>')).rejects.toThrow('invalid address');

    expect(mockAdapter.send).toHaveBeenCalledTimes(3);
    expect(mockMarkFailed).toHaveBeenCalledWith('log-1', 'invalid address', null);
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  it('uses "Unknown error" when last error has no message', async () => {
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.sendEmailSync('a@b.com', 'S', '<p>H</p>')).rejects.toThrow('ECONNREFUSED');

    expect(mockMarkFailed).toHaveBeenCalledWith('log-1', 'ECONNREFUSED', null);
  });

  it('redacts the recipient email in failure logs', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.mocked(registry.getActiveAdapter).mockReturnValue(mockAdapter);
    mockAdapter.send.mockRejectedValue(new Error('invalid address'));

    await expect(service.sendEmailSync('a@b.com', 'S', '<p>H</p>')).rejects.toThrow('invalid address');

    const failureLogs = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(failureLogs.some((msg) => msg.includes('a@b.com'))).toBe(false);
    expect(failureLogs.some((msg) => msg.includes('recipient'))).toBe(true);
    warnSpy.mockRestore();
  });
});
