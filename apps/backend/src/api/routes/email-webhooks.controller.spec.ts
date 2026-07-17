import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

vi.mock('@gitroom/nestjs-libraries/database/prisma/emails/email-log.service', () => ({
  EmailLogService: class MockEmailLogService {
    applyWebhookEvent = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@gitroom/nestjs-libraries/emails/email-adapter.registry', () => ({
  EmailAdapterRegistry: class MockEmailAdapterRegistry {
    getActiveAdapter = vi.fn();
  },
}));

import { EmailWebhooksController } from './email-webhooks.controller';
import { EmailLogService } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service';
import { EmailAdapterRegistry } from '@gitroom/nestjs-libraries/emails/email-adapter.registry';
import type { EmailAdapter } from '@gitroom/nestjs-libraries/emails/email-adapter.interface';

interface BuildAdapterOptions {
  name?: string;
  webhooksCapability?: boolean;
  hasVerifyWebhook?: boolean;
  hasParseWebhook?: boolean;
  verifyWebhook?: () => Promise<boolean> | boolean;
  parseWebhook?: () => any[];
}

function buildMockAdapter(opts: BuildAdapterOptions = {}): EmailAdapter {
  const hasVerify = opts.hasVerifyWebhook ?? true;
  const hasParse = opts.hasParseWebhook ?? true;

  return {
    name: opts.name ?? 'test-provider',
    capabilities: {
      webhooks: opts.webhooksCapability ?? true,
      openTracking: false,
      clickTracking: false,
    },
    requiredEnvKeys: [],
    isConfigured: vi.fn().mockReturnValue(true),
    send: vi.fn(),
    verifyWebhook: hasVerify
      ? opts.verifyWebhook
        ? vi.fn().mockImplementation(opts.verifyWebhook as any)
        : vi.fn()
      : undefined,
    parseWebhook: hasParse
      ? opts.parseWebhook
        ? vi.fn().mockImplementation(opts.parseWebhook as any)
        : vi.fn()
      : undefined,
  } as EmailAdapter;
}

function mockRequest(rawBody: Buffer = Buffer.from('{}')) {
  return {
    rawBody,
    headers: { 'x-signature': 'abc' },
  } as any;
}

describe('EmailWebhooksController', () => {
  let controller: EmailWebhooksController;
  let emailLog: EmailLogService;
  let registry: EmailAdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    emailLog = new (EmailLogService as any)();
    registry = new (EmailAdapterRegistry as any)();
    controller = new EmailWebhooksController(emailLog, registry);
  });

  it('returns { ok: true } when adapter has no webhooks capability', async () => {
    const adapter = buildMockAdapter({ webhooksCapability: false });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const result = await controller.handle(mockRequest());

    expect(result).toEqual({ ok: true });
    expect(registry.getActiveAdapter).toHaveBeenCalled();
  });

  it('returns { ok: true } when adapter has webhooks but no verifyWebhook method', async () => {
    const adapter = buildMockAdapter({ hasVerifyWebhook: false });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const result = await controller.handle(mockRequest());

    expect(result).toEqual({ ok: true });
    expect(registry.getActiveAdapter).toHaveBeenCalled();
  });

  it('returns { ok: true } when adapter has webhooks but no parseWebhook method', async () => {
    const adapter = buildMockAdapter({ hasParseWebhook: false });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const result = await controller.handle(mockRequest());

    expect(result).toEqual({ ok: true });
    expect(registry.getActiveAdapter).toHaveBeenCalled();
  });

  it('throws 401 HttpException when verifyWebhook returns false', async () => {
    const adapter = buildMockAdapter({ verifyWebhook: () => false });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const req = mockRequest();

    await expect(controller.handle(req)).rejects.toThrow(HttpException);
    await expect(controller.handle(req)).rejects.toThrow('invalid signature');

    expect(adapter.verifyWebhook).toHaveBeenCalledWith(req.rawBody, req.headers);
  });

  it('calls parseWebhook and applies events when verifyWebhook passes', async () => {
    const event = { providerMessageId: 'msg-1', status: 'delivered', occurredAt: new Date() };
    const adapter = buildMockAdapter({
      name: 'sendgrid',
      verifyWebhook: () => true,
      parseWebhook: () => [event],
    });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const req = mockRequest();

    const result = await controller.handle(req);

    expect(adapter.verifyWebhook).toHaveBeenCalledWith(req.rawBody, req.headers);
    expect(adapter.parseWebhook).toHaveBeenCalledWith(req.rawBody, req.headers);
    expect(emailLog.applyWebhookEvent).toHaveBeenCalledWith('sendgrid', event);
    expect(result).toEqual({ ok: true });
  });

  it('applies each event when parseWebhook returns multiple events', async () => {
    const events = [
      { providerMessageId: 'msg-1', status: 'delivered' as const, occurredAt: new Date() },
      { providerMessageId: 'msg-2', status: 'opened' as const, occurredAt: new Date() },
      { providerMessageId: 'msg-3', status: 'clicked' as const, occurredAt: new Date() },
    ];
    const adapter = buildMockAdapter({
      name: 'mailgun',
      verifyWebhook: () => true,
      parseWebhook: () => events,
    });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const result = await controller.handle(mockRequest());

    expect(emailLog.applyWebhookEvent).toHaveBeenCalledTimes(3);
    expect(emailLog.applyWebhookEvent).toHaveBeenNthCalledWith(1, 'mailgun', events[0]);
    expect(emailLog.applyWebhookEvent).toHaveBeenNthCalledWith(2, 'mailgun', events[1]);
    expect(emailLog.applyWebhookEvent).toHaveBeenNthCalledWith(3, 'mailgun', events[2]);
    expect(result).toEqual({ ok: true });
  });

  it('handles empty events array from parseWebhook', async () => {
    const adapter = buildMockAdapter({
      verifyWebhook: () => true,
      parseWebhook: () => [],
    });
    (registry.getActiveAdapter as any).mockReturnValue(adapter);

    const result = await controller.handle(mockRequest());

    expect(emailLog.applyWebhookEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });
});
