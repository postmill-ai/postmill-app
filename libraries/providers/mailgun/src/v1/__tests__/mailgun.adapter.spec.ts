import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('mailgun.js', () => ({
  default: vi.fn(),
}));

vi.mock('form-data', () => ({
  default: vi.fn(),
}));

import Mailgun from 'mailgun.js';
import { MailgunAdapter } from '../email.adapter';

interface MockMessages {
  create: ReturnType<typeof vi.fn>;
}

interface MockClient {
  messages: MockMessages;
}

describe('MailgunAdapter', () => {
  let adapter: MailgunAdapter;
  let mockMessagesCreate: ReturnType<typeof vi.fn>;
  let mockClient: MockClient;

  beforeEach(() => {
    process.env.EMAIL_API_KEY = 'key-test123';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    process.env.EMAIL_FROM_NAME = 'Test Sender';
    process.env.EMAIL_MAILGUN_DOMAIN = 'mg.example.com';

    vi.clearAllMocks();

    mockMessagesCreate = vi.fn().mockResolvedValue({ id: '<msg_001@mg.example.com>' });

    mockClient = {
      messages: { create: mockMessagesCreate },
    };

    vi.mocked(Mailgun).mockImplementation(function () {
      return {
        client: vi.fn().mockReturnValue(mockClient),
      } as any;
    });

    adapter = new MailgunAdapter();
  });

  afterEach(() => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.EMAIL_MAILGUN_DOMAIN;
    delete process.env.EMAIL_REGION;
  });

  describe('metadata', () => {
    it('has name "mailgun"', () => {
      expect(adapter.name).toBe('mailgun');
    });

    it('has webhooks, openTracking, and clickTracking enabled', () => {
      expect(adapter.capabilities).toEqual({
        webhooks: true,
        openTracking: true,
        clickTracking: true,
      });
    });

    it('has required env keys including MAILGUN_DOMAIN', () => {
      expect(adapter.requiredEnvKeys).toEqual([
        'EMAIL_API_KEY',
        'EMAIL_FROM_ADDRESS',
        'EMAIL_FROM_NAME',
        'EMAIL_MAILGUN_DOMAIN',
      ]);
    });
  });

  describe('isConfigured', () => {
    it('returns true when EMAIL_API_KEY and EMAIL_MAILGUN_DOMAIN are set', () => {
      expect(adapter.isConfigured()).toBe(true);
    });

    it('returns false when EMAIL_API_KEY is missing', () => {
      delete process.env.EMAIL_API_KEY;
      expect(adapter.isConfigured()).toBe(false);
    });

    it('returns false when EMAIL_MAILGUN_DOMAIN is missing', () => {
      delete process.env.EMAIL_MAILGUN_DOMAIN;
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('send', () => {
    const sendParams = {
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<h1>Welcome</h1>',
      fromName: 'Test Sender',
      fromAddress: 'noreply@example.com',
    };

    it('calls mg.messages.create with correct params including domain', async () => {
      const result = await adapter.send(sendParams);

      expect(mockMessagesCreate).toHaveBeenCalledWith('mg.example.com', {
        from: 'Test Sender <noreply@example.com>',
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<h1>Welcome</h1>',
      });
      expect(result).toEqual({ providerMessageId: '<msg_001@mg.example.com>' });
    });

    it('includes h:Reply-To header when replyTo is provided', async () => {
      await adapter.send({ ...sendParams, replyTo: 'reply@example.com' });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        'mg.example.com',
        expect.objectContaining({
          'h:Reply-To': 'reply@example.com',
        }),
      );
    });

    it('returns providerMessageId from response.id', async () => {
      const result = await adapter.send(sendParams);
      expect(result.providerMessageId).toBe('<msg_001@mg.example.com>');
    });

    it('falls back to response.message when id is missing', async () => {
      mockMessagesCreate.mockResolvedValueOnce({ message: 'Queued. Thank you.' });

      const result = await adapter.send(sendParams);
      expect(result.providerMessageId).toBe('Queued. Thank you.');
    });
  });

  describe('verifyWebhook', () => {
    it('returns true with correct HMAC signature', () => {
      const timestamp = '1529006854';
      const token = 'a8ce0edb2dd8301dee6c339523000000';
      const apiKey = process.env.EMAIL_API_KEY!;
      const signature = crypto
        .createHmac('sha256', apiKey)
        .update(timestamp + token)
        .digest('hex');

      const rawBody = Buffer.from(JSON.stringify({ signature: '{}', 'event-data': {} }));
      const headers = {
        'x-mailgun-signature-timestamp': timestamp,
        'x-mailgun-signature-token': token,
        'x-mailgun-signature-signature': signature,
      };

      const result = adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(true);
    });

    it('returns false with wrong signature', () => {
      const timestamp = '1529006854';
      const token = 'a8ce0edb2dd8301dee6c339523000000';

      const rawBody = Buffer.from(JSON.stringify({}));
      const headers = {
        'x-mailgun-signature-timestamp': timestamp,
        'x-mailgun-signature-token': token,
        'x-mailgun-signature-signature': 'deadbeef',
      };

      const result = adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(false);
    });

    it('returns false when signature header is missing', () => {
      const rawBody = Buffer.from(JSON.stringify({}));
      const headers = {
        'x-mailgun-signature-timestamp': '1529006854',
        'x-mailgun-signature-token': 'token123',
      };

      const result = adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(false);
    });

    it('returns false when token header is missing', () => {
      const rawBody = Buffer.from(JSON.stringify({}));
      const headers = {
        'x-mailgun-signature-timestamp': '1529006854',
        'x-mailgun-signature-signature': 'sig123',
      };

      const result = adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    const baseEventData = {
      event: 'delivered',
      timestamp: 1529006854,
      recipient: 'user@example.com',
      message: {
        headers: {
          'message-id': '<msg_001@mg.example.com>',
        },
      },
    };

    it('maps delivered event', () => {
      const rawBody = Buffer.from(
        JSON.stringify({ 'event-data': baseEventData }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        {
          providerMessageId: '<msg_001@mg.example.com>',
          recipient: 'user@example.com',
          status: 'delivered',
          occurredAt: new Date(1529006854 * 1000),
        },
      ]);
    });

    it('maps complained event', () => {
      const rawBody = Buffer.from(
        JSON.stringify({ 'event-data': { ...baseEventData, event: 'complained' } }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({ status: 'complained' }),
      ]);
    });

    it('maps opened event', () => {
      const rawBody = Buffer.from(
        JSON.stringify({ 'event-data': { ...baseEventData, event: 'opened' } }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({ status: 'opened' }),
      ]);
    });

    it('maps clicked event', () => {
      const rawBody = Buffer.from(
        JSON.stringify({ 'event-data': { ...baseEventData, event: 'clicked' } }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({ status: 'clicked' }),
      ]);
    });

    it('maps failed with severity=permanent to bounced', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          'event-data': {
            ...baseEventData,
            event: 'failed',
            severity: 'permanent',
          },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        {
          providerMessageId: '<msg_001@mg.example.com>',
          recipient: 'user@example.com',
          status: 'bounced',
          occurredAt: new Date(1529006854 * 1000),
        },
      ]);
    });

    it('ignores failed with severity=temporary (returns [])', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          'event-data': {
            ...baseEventData,
            event: 'failed',
            severity: 'temporary',
          },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([]);
    });

    it('ignores failed without severity field (returns [])', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          'event-data': {
            ...baseEventData,
            event: 'failed',
          },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([]);
    });

    it('returns [] for unknown event type', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          'event-data': { ...baseEventData, event: 'clicked_open_mixpanel' },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([]);
    });
  });
});
