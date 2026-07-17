import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('resend', () => ({
  Resend: vi.fn(),
}));

vi.mock('svix', () => ({
  Webhook: vi.fn(),
}));

import { Resend } from 'resend';
import { Webhook } from 'svix';
import { ResendAdapter } from '../email.adapter';

describe('ResendAdapter', () => {
  let adapter: ResendAdapter;
  let mockEmailsSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.EMAIL_API_KEY = 're_test123';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    process.env.EMAIL_FROM_NAME = 'Test Sender';
    process.env.EMAIL_WEBHOOK_SECRET = 'whsec_test';

    vi.clearAllMocks();

    mockEmailsSend = vi.fn().mockResolvedValue({ data: { id: 'msg_001' }, error: null });
    vi.mocked(Resend).mockImplementation(function () {
      return {
        emails: { send: mockEmailsSend },
      } as any;
    });

    adapter = new ResendAdapter();
  });

  afterEach(() => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.EMAIL_WEBHOOK_SECRET;
  });

  describe('metadata', () => {
    it('has name "resend"', () => {
      expect(adapter.name).toBe('resend');
    });

    it('has all capabilities enabled', () => {
      expect(adapter.capabilities).toEqual({
        webhooks: true,
        openTracking: true,
        clickTracking: true,
      });
    });

    it('has required env keys', () => {
      expect(adapter.requiredEnvKeys).toEqual([
        'EMAIL_API_KEY',
        'EMAIL_FROM_ADDRESS',
        'EMAIL_FROM_NAME',
      ]);
    });
  });

  describe('isConfigured', () => {
    it('returns true when EMAIL_API_KEY is set', () => {
      expect(adapter.isConfigured()).toBe(true);
    });

    it('returns false when EMAIL_API_KEY is empty', () => {
      process.env.EMAIL_API_KEY = '';
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

    it('calls resend.emails.send with correct params and formatted from field', async () => {
      const result = await adapter.send(sendParams);

      expect(mockEmailsSend).toHaveBeenCalledWith({
        from: 'Test Sender <noreply@example.com>',
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<h1>Welcome</h1>',
      });
      expect(result).toEqual({ providerMessageId: 'msg_001' });
    });

    it('includes replyTo (camelCase, the key resend@6 reads) when provided', async () => {
      await adapter.send({ ...sendParams, replyTo: 'reply@example.com' });

      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: 'reply@example.com',
        }),
      );
      // must NOT emit the dropped snake_case key
      expect(mockEmailsSend.mock.calls[0][0]).not.toHaveProperty('reply_to');
    });

    it('throws resend error message (not "[object Object]")', async () => {
      mockEmailsSend.mockResolvedValueOnce({
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'rate limited' },
      });

      await expect(adapter.send(sendParams)).rejects.toThrow('rate limited');
    });

    it('returns empty providerMessageId when data.id is missing', async () => {
      mockEmailsSend.mockResolvedValueOnce({ data: {}, error: null });

      const result = await adapter.send(sendParams);
      expect(result.providerMessageId).toBeUndefined();
    });
  });

  describe('verifyWebhook', () => {
    it('returns true when svix verifies successfully', () => {
      const mockVerify = vi.fn();
      vi.mocked(Webhook).mockImplementation(function () {
        return { verify: mockVerify } as any;
      });

      const rawBody = Buffer.from(JSON.stringify({ type: 'email.delivered' }));
      const headers = {
        'svix-id': 'msg_123',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,sig123',
      };

      const result = adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(true);
      expect(mockVerify).toHaveBeenCalledWith(rawBody.toString(), {
        'svix-id': 'msg_123',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,sig123',
      });
    });

    it('returns false when svix throws', () => {
      vi.mocked(Webhook).mockImplementation(function () {
        return { verify: vi.fn().mockImplementation(() => { throw new Error('invalid'); }) } as any;
      });

      const result = adapter.verifyWebhook(
        Buffer.from('{}'),
        { 'svix-id': 'bad', 'svix-timestamp': '0', 'svix-signature': 'bad' },
      );
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('maps delivered event correctly', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'email.delivered',
          data: { email_id: 'msg_001', to: ['user@example.com'] },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        {
          providerMessageId: 'msg_001',
          recipient: 'user@example.com',
          status: 'delivered',
          occurredAt: expect.any(Date),
        },
      ]);
    });

    it('maps bounced event correctly', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'email.bounced',
          data: { email_id: 'msg_002', to: ['bad@example.com'] },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({
          providerMessageId: 'msg_002',
          status: 'bounced',
        }),
      ]);
    });

    it('maps complained event correctly', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'email.complained',
          data: { email_id: 'msg_003', to: ['user@example.com'] },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({
          status: 'complained',
        }),
      ]);
    });

    it('maps opened event correctly', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'email.opened',
          data: { email_id: 'msg_004', to: ['user@example.com'] },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({
          status: 'opened',
        }),
      ]);
    });

    it('maps clicked event correctly', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'email.clicked',
          data: { email_id: 'msg_005', to: ['user@example.com'] },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([
        expect.objectContaining({
          status: 'clicked',
        }),
      ]);
    });

    it('returns empty array for unknown event type', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'email.unknown',
          data: { email_id: 'msg_006' },
        }),
      );

      const result = adapter.parseWebhook(rawBody, {});
      expect(result).toEqual([]);
    });
  });
});
