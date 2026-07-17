import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockSetApiKey,
  mockSend,
  mockConvertPublicKeyToECDSA,
  mockVerifySignature,
} = vi.hoisted(() => ({
  mockSetApiKey: vi.fn(),
  mockSend: vi.fn(),
  mockConvertPublicKeyToECDSA: vi.fn(),
  mockVerifySignature: vi.fn(),
}));

vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: mockSetApiKey,
    send: mockSend,
  },
}));

vi.mock('@sendgrid/eventwebhook', () => ({
  EventWebhook: class {
    convertPublicKeyToECDSA = mockConvertPublicKeyToECDSA;
    verifySignature = mockVerifySignature;
  },
  EventWebhookHeader: {
    SIGNATURE: () => 'X-Twilio-Email-Event-Webhook-Signature',
    TIMESTAMP: () => 'X-Twilio-Email-Event-Webhook-Timestamp',
  },
}));

import { SendGridAdapter } from '../email.adapter';

describe('SendGridAdapter', () => {
  let adapter: SendGridAdapter;

  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.EMAIL_API_KEY = 'sg-key-test';
    adapter = new SendGridAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // --- metadata ---

  it('has name "sendgrid"', () => {
    expect(adapter.name).toBe('sendgrid');
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
    process.env.EMAIL_API_KEY = 'sg-key';
    expect(adapter.isConfigured()).toBe(true);
  });

  it('returns false when EMAIL_API_KEY is missing', () => {
    delete process.env.EMAIL_API_KEY;
    expect(adapter.isConfigured()).toBe(false);
  });

  // --- send ---

  it('lazily initializes sgMail with API key on first send', async () => {
    process.env.EMAIL_API_KEY = 'sg-key';

    const mockResponse = { headers: { 'x-message-id': 'msg-abc' } };
    mockSend.mockResolvedValueOnce([mockResponse, {}]);

    await adapter.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      fromName: 'Sender',
      fromAddress: 'sender@example.com',
    });

    expect(mockSetApiKey).toHaveBeenCalledWith('sg-key');
  });

  it('maps send params to SendGrid message format', async () => {
    process.env.EMAIL_API_KEY = 'sg-key';

    const mockResponse = { headers: { 'x-message-id': 'msg-abc' } };
    mockSend.mockResolvedValueOnce([mockResponse, {}]);

    const result = await adapter.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      fromName: 'Sender',
      fromAddress: 'sender@example.com',
      replyTo: 'reply@example.com',
    });

    expect(mockSend).toHaveBeenCalledWith({
      to: 'user@example.com',
      from: { email: 'sender@example.com', name: 'Sender' },
      subject: 'Hello',
      html: '<p>Hi</p>',
      replyTo: 'reply@example.com',
    });
    expect(result).toEqual({ providerMessageId: 'msg-abc' });
  });

  it('omits replyTo when not provided', async () => {
    process.env.EMAIL_API_KEY = 'sg-key';

    const mockResponse = { headers: {} };
    mockSend.mockResolvedValueOnce([mockResponse, {}]);

    await adapter.send({
      to: 'user@example.com',
      subject: 'S',
      html: '<p>H</p>',
      fromName: 'S',
      fromAddress: 's@x.com',
    });

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.replyTo).toBeUndefined();
  });

  it('returns providerMessageId from x-message-id header', async () => {
    process.env.EMAIL_API_KEY = 'sg-key';

    const mockResponse = { headers: { 'x-message-id': 'msg-xyz-123' } };
    mockSend.mockResolvedValueOnce([mockResponse, {}]);

    const result = await adapter.send({
      to: 'user@example.com',
      subject: 'S',
      html: '<p>H</p>',
      fromName: 'S',
      fromAddress: 's@x.com',
    });

    expect(result).toEqual({ providerMessageId: 'msg-xyz-123' });
  });

  it('returns undefined providerMessageId when header is missing', async () => {
    process.env.EMAIL_API_KEY = 'sg-key';

    const mockResponse = { headers: {} };
    mockSend.mockResolvedValueOnce([mockResponse, {}]);

    const result = await adapter.send({
      to: 'user@example.com',
      subject: 'S',
      html: '<p>H</p>',
      fromName: 'S',
      fromAddress: 's@x.com',
    });

    expect(result).toEqual({ providerMessageId: undefined });
  });

  // --- verifyWebhook ---

  it('verifies webhook using ECDSA public key and verification key', async () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'whsec-test';
    mockConvertPublicKeyToECDSA.mockReturnValue('pubkey');
    mockVerifySignature.mockReturnValue(true);

    const rawBody = Buffer.from('[{"event":"delivered"}]');
    const headers = {
      'X-Twilio-Email-Event-Webhook-Signature': 'sig123',
      'X-Twilio-Email-Event-Webhook-Timestamp': '1234567890',
    };

    const result = await adapter.verifyWebhook!(rawBody, headers);

    expect(mockConvertPublicKeyToECDSA).toHaveBeenCalledWith('whsec-test');
    expect(mockVerifySignature).toHaveBeenCalledWith(
      'pubkey',
      '[{"event":"delivered"}]',
      'sig123',
      '1234567890',
    );
    expect(result).toBe(true);
  });

  it('returns false when verification fails', async () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'whsec-test';
    mockConvertPublicKeyToECDSA.mockReturnValue('pubkey');
    mockVerifySignature.mockReturnValue(false);

    const rawBody = Buffer.from('[]');
    const headers = {
      'X-Twilio-Email-Event-Webhook-Signature': 'bad',
      'X-Twilio-Email-Event-Webhook-Timestamp': '0',
    };

    const result = await adapter.verifyWebhook!(rawBody, headers);
    expect(result).toBe(false);
  });

  it('returns false on exception during verification', async () => {
    process.env.EMAIL_WEBHOOK_SECRET = 'whsec-test';
    mockConvertPublicKeyToECDSA.mockImplementation(() => {
      throw new Error('invalid key');
    });

    const result = await adapter.verifyWebhook!(
      Buffer.from('[]'),
      {
        'X-Twilio-Email-Event-Webhook-Signature': 'x',
        'X-Twilio-Email-Event-Webhook-Timestamp': '0',
      },
    );
    expect(result).toBe(false);
  });

  // --- parseWebhook ---

  it('maps delivered event', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'delivered',
          sg_message_id: 'msg-abc.filter-1',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events).toEqual([
      {
        providerMessageId: 'msg-abc',
        recipient: 'user@example.com',
        status: 'delivered',
        occurredAt: new Date(1700000000 * 1000),
      },
    ]);
  });

  it('maps bounce event to bounced', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'bounce',
          sg_message_id: 'msg-bad.filter-1',
          email: 'bounce@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('bounced');
  });

  it('maps dropped event to failed', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'dropped',
          sg_message_id: 'msg-drop.filter-1',
          email: 'drop@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('failed');
  });

  it('maps spamreport event to complained', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'spamreport',
          sg_message_id: 'msg-spam.filter-1',
          email: 'spam@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('complained');
  });

  it('maps open event to opened', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'open',
          sg_message_id: 'msg-open.filter-1',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('opened');
  });

  it('maps click event to clicked', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'click',
          sg_message_id: 'msg-click.filter-1',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('clicked');
  });

  it('handles multiple events in array', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'delivered',
          sg_message_id: 'msg-1.filter-1',
          email: 'a@x.com',
          timestamp: 1700000000,
        },
        {
          event: 'open',
          sg_message_id: 'msg-1.filter-1',
          email: 'a@x.com',
          timestamp: 1700000100,
        },
        {
          event: 'click',
          sg_message_id: 'msg-1.filter-1',
          email: 'a@x.com',
          timestamp: 1700000200,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events).toHaveLength(3);
    expect(events[0].status).toBe('delivered');
    expect(events[1].status).toBe('opened');
    expect(events[2].status).toBe('clicked');
  });

  it('strips filter suffix from sg_message_id', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'delivered',
          sg_message_id: 'abc123.def456.ghi789',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].providerMessageId).toBe('abc123');
  });

  it('strips filter suffix from sg_message_id with only one dot', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'delivered',
          sg_message_id: 'abc123.filter',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].providerMessageId).toBe('abc123');
  });

  it('returns full msg id when no dot in sg_message_id', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'delivered',
          sg_message_id: 'simple-id',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].providerMessageId).toBe('simple-id');
  });

  it('defaults unknown event to delivered', () => {
    const rawBody = Buffer.from(
      JSON.stringify([
        {
          event: 'something-unknown',
          sg_message_id: 'msg-1.filter-1',
          email: 'user@example.com',
          timestamp: 1700000000,
        },
      ]),
    );

    const events = adapter.parseWebhook!(rawBody, {});
    expect(events[0].status).toBe('delivered');
  });
});
