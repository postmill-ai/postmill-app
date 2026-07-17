import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendEmail = vi.fn();

vi.mock('postmark', () => ({
  ServerClient: vi.fn(),
}));

import { ServerClient } from 'postmark';
import { PostmarkAdapter } from '../email.adapter';

describe('PostmarkAdapter', () => {
  let adapter: PostmarkAdapter;

  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.EMAIL_API_KEY = 'pm-key-test';
    vi.clearAllMocks();

    vi.mocked(ServerClient).mockImplementation(function () {
      return { sendEmail: mockSendEmail } as any;
    });

    adapter = new PostmarkAdapter();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // --- metadata ---

  it('has name "postmark"', () => {
    expect(adapter.name).toBe('postmark');
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

  // --- isConfigured ---

  it('returns true when EMAIL_API_KEY is set', () => {
    process.env.EMAIL_API_KEY = 'pm-key';
    expect(adapter.isConfigured()).toBe(true);
  });

  it('returns false when EMAIL_API_KEY is missing', () => {
    delete process.env.EMAIL_API_KEY;
    expect(adapter.isConfigured()).toBe(false);
  });

  // --- send ---

  it('lazily constructs ServerClient with API key', async () => {
    process.env.EMAIL_API_KEY = 'pm-key';
    mockSendEmail.mockResolvedValueOnce({ MessageID: 'msg-abc' });

    await adapter.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      fromName: 'Sender',
      fromAddress: 'sender@example.com',
    });

    expect(ServerClient).toHaveBeenCalledWith('pm-key');
  });

  it('maps send params to Postmark message format', async () => {
    process.env.EMAIL_API_KEY = 'pm-key';
    mockSendEmail.mockResolvedValueOnce({ MessageID: 'msg-abc' });

    const result = await adapter.send({
      to: 'user@example.com',
      subject: 'Hello World',
      html: '<p>Content</p>',
      fromName: 'My Name',
      fromAddress: 'noreply@example.com',
      replyTo: 'reply@example.com',
    });

    expect(mockSendEmail).toHaveBeenCalledWith({
      From: 'My Name <noreply@example.com>',
      To: 'user@example.com',
      Subject: 'Hello World',
      HtmlBody: '<p>Content</p>',
      ReplyTo: 'reply@example.com',
    });
    expect(result).toEqual({ providerMessageId: 'msg-abc' });
  });

  it('omits ReplyTo when not provided', async () => {
    process.env.EMAIL_API_KEY = 'pm-key';
    mockSendEmail.mockResolvedValueOnce({ MessageID: 'msg-1' });

    await adapter.send({
      to: 'user@example.com',
      subject: 'S',
      html: '<p>H</p>',
      fromName: 'N',
      fromAddress: 'a@b.com',
    });

    const callArgs = mockSendEmail.mock.calls[0][0];
    expect(callArgs.ReplyTo).toBeUndefined();
  });

  it('returns providerMessageId from response.MessageID', async () => {
    process.env.EMAIL_API_KEY = 'pm-key';
    mockSendEmail.mockResolvedValueOnce({ MessageID: 'postmark-msg-xyz-789' });

    const result = await adapter.send({
      to: 'user@example.com',
      subject: 'S',
      html: '<p>H</p>',
      fromName: 'S',
      fromAddress: 's@x.com',
    });

    expect(result).toEqual({ providerMessageId: 'postmark-msg-xyz-789' });
  });

  // --- verifyWebhook ---

  it('returns true when x-postmark-secret header matches EMAIL_WEBHOOK_SECRET', () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'shared-secret-123';

    const result = adapter.verifyWebhook!(Buffer.from('{}'), {
      'x-postmark-secret': 'shared-secret-123',
    });
    expect(result).toBe(true);
  });

  it('returns true when x-secret header matches EMAIL_WEBHOOK_SECRET', () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'shared-secret-456';

    const result = adapter.verifyWebhook!(Buffer.from('{}'), {
      'x-secret': 'shared-secret-456',
    });
    expect(result).toBe(true);
  });

  it('prefers x-postmark-secret over x-secret', () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'shared-secret';

    const result = adapter.verifyWebhook!(Buffer.from('{}'), {
      'x-postmark-secret': 'shared-secret',
      'x-secret': 'wrong',
    });
    expect(result).toBe(true);
  });

  it('returns false when header does not match secret', () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'shared-secret';

    const result = adapter.verifyWebhook!(Buffer.from('{}'), {
      'x-postmark-secret': 'wrong-secret',
    });
    expect(result).toBe(false);
  });

  it('returns false when EMAIL_WEBHOOK_SECRET is not configured', () => {
    delete process.env.EMAIL_WEBHOOK_SECRET;

    const result = adapter.verifyWebhook!(Buffer.from('{}'), {
      'x-postmark-secret': 'anything',
    });
    expect(result).toBe(false);
  });

  it('returns false when no secret header is present', () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'shared-secret';

    const result = adapter.verifyWebhook!(Buffer.from('{}'), {});
    expect(result).toBe(false);
  });

  // --- parseWebhook ---

  it('maps Delivery RecordType to delivered', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'Delivery',
        MessageID: 'msg-abc',
        Recipient: 'user@example.com',
        ReceivedAt: '2024-01-15T10:30:00Z',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events).toEqual([
      {
        providerMessageId: 'msg-abc',
        recipient: 'user@example.com',
        status: 'delivered',
        occurredAt: new Date('2024-01-15T10:30:00Z'),
      },
    ]);
  });

  it('maps Bounce RecordType to bounced', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'Bounce',
        MessageID: 'msg-bad',
        Recipient: 'bad@example.com',
        ReceivedAt: '2024-01-15T10:00:00Z',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('bounced');
  });

  it('maps SpamComplaint RecordType to complained', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'SpamComplaint',
        MessageID: 'msg-spam',
        Recipient: 'spam@example.com',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('complained');
  });

  it('maps Open RecordType to opened', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'Open',
        MessageID: 'msg-open',
        Recipient: 'user@example.com',
        ReceivedAt: '2024-01-15T11:00:00Z',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('opened');
  });

  it('maps Click RecordType to clicked', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'Click',
        MessageID: 'msg-click',
        Recipient: 'user@example.com',
        ReceivedAt: '2024-01-15T12:00:00Z',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('clicked');
  });

  it('uses OccurredAt when ReceivedAt is missing', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'Delivery',
        MessageID: 'msg-1',
        Recipient: 'user@example.com',
        OccurredAt: '2024-01-15T13:00:00Z',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].occurredAt).toEqual(new Date('2024-01-15T13:00:00Z'));
  });

  it('returns empty array for unknown RecordType', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        RecordType: 'SomeUnknownType',
        MessageID: 'msg-1',
        Recipient: 'user@example.com',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events).toEqual([]);
  });

  it('returns empty array when RecordType is missing', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        MessageID: 'msg-1',
        Recipient: 'user@example.com',
      }),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events).toEqual([]);
  });
});
