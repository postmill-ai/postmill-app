import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(),
  SendEmailCommand: vi.fn(),
}));

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesAdapter } from '../email.adapter';

describe('SesAdapter', () => {
  let adapter: SesAdapter;
  let mockSend: ReturnType<typeof vi.fn>;
  // safeFetch is threaded into the adapter via the kernel SafeFetchPort
  // (constructor) rather than importing nestjs-libraries.
  let safeFetch: ReturnType<typeof vi.fn>;

  const defaultTopicArn = 'arn:aws:sns:us-east-1:123456789012:my-topic';

  beforeEach(() => {
    process.env.EMAIL_REGION = 'us-east-1';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    process.env.EMAIL_FROM_NAME = 'Test Sender';
    process.env.EMAIL_WEBHOOK_SECRET = defaultTopicArn;

    vi.clearAllMocks();

    safeFetch = vi.fn();
    mockSend = vi.fn().mockResolvedValue({ MessageId: 'ses-msg-001' });
    vi.mocked(SESv2Client).mockImplementation(function (config: any) {
      return { send: mockSend, _config: config };
    } as any);
    vi.mocked(SendEmailCommand).mockImplementation(function (this: any, params: any) {
      Object.assign(this, params);
      return this;
    } as any);

    adapter = new SesAdapter(safeFetch);
  });

  afterEach(() => {
    delete process.env.EMAIL_REGION;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.EMAIL_WEBHOOK_SECRET;
    delete process.env.EMAIL_SES_ACCESS_KEY_ID;
    delete process.env.EMAIL_SES_SECRET_ACCESS_KEY;
  });

  describe('metadata', () => {
    it('has name "ses"', () => {
      expect(adapter.name).toBe('ses');
    });

    it('has correct capabilities', () => {
      expect(adapter.capabilities).toEqual({
        webhooks: true,
        openTracking: false,
        clickTracking: false,
      });
    });

    it('has required env keys', () => {
      expect(adapter.requiredEnvKeys).toEqual([
        'EMAIL_REGION',
        'EMAIL_FROM_ADDRESS',
        'EMAIL_FROM_NAME',
      ]);
    });
  });

  describe('isConfigured', () => {
    it('returns true when EMAIL_REGION is set', () => {
      expect(adapter.isConfigured()).toBe(true);
    });

    it('returns false when EMAIL_REGION is not set', () => {
      process.env.EMAIL_REGION = '';
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

    it('calls SESv2Client.send with correct SendEmailCommand params', async () => {
      const result = await adapter.send(sendParams);

      expect(SendEmailCommand).toHaveBeenCalledWith({
        FromEmailAddress: 'Test Sender <noreply@example.com>',
        Destination: { ToAddresses: ['user@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 'Welcome' },
            Body: { Html: { Data: '<h1>Welcome</h1>' } },
          },
        },
      });
      expect(mockSend).toHaveBeenCalled();
      expect(result).toEqual({ providerMessageId: 'ses-msg-001' });
    });

    it('includes ReplyToAddresses when replyTo provided', async () => {
      await adapter.send({ ...sendParams, replyTo: 'reply@example.com' });

      expect(SendEmailCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ReplyToAddresses: ['reply@example.com'],
        }),
      );
    });

    it('returns MessageId from response', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'custom-message-id' });

      const result = await adapter.send(sendParams);
      expect(result).toEqual({ providerMessageId: 'custom-message-id' });
    });

    it('constructs client with EMAIL_SES_ACCESS_KEY_ID/SECRET when provided', async () => {
      process.env.EMAIL_SES_ACCESS_KEY_ID = 'AKID1234';
      process.env.EMAIL_SES_SECRET_ACCESS_KEY = 'super-secret';

      vi.clearAllMocks();
      mockSend = vi.fn().mockResolvedValue({ MessageId: 'ses-msg-001' });
      vi.mocked(SESv2Client).mockImplementation(function (config: any) {
        return { send: mockSend, _config: config };
      } as any);
      vi.mocked(SendEmailCommand).mockImplementation(function (this: any, params: any) {
        Object.assign(this, params);
        return this;
      } as any);
      adapter = new SesAdapter(safeFetch);

      await adapter.send(sendParams);

      expect(SESv2Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKID1234',
          secretAccessKey: 'super-secret',
        },
      });
    });
  });

  describe('verifyWebhook', () => {
    const snsSubscribeUrl = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc123';
    const snsCertUrl = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-certificate.pem';

    describe('SubscriptionConfirmation', () => {
      // Generating a 2048-bit RSA key pair synchronously is CPU-intensive and can
      // exceed the default 5s test timeout under parallel load. Generate once for
      // the whole SubscriptionConfirmation block and reuse it across tests.
      const { publicKey: subPublicKey, privateKey: subPrivateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      // Canonical SNS signing string for SubscriptionConfirmation includes
      // SubscribeURL + Token (not Subject).
      const buildSubSigningString = (payload: any): string => {
        const lines: string[] = [];
        lines.push('Message');
        lines.push(payload.Message ?? '');
        lines.push('MessageId');
        lines.push(payload.MessageId ?? '');
        lines.push('SubscribeURL');
        lines.push(payload.SubscribeURL ?? '');
        lines.push('Timestamp');
        lines.push(payload.Timestamp ?? '');
        lines.push('Token');
        lines.push(payload.Token ?? '');
        lines.push('TopicArn');
        lines.push(payload.TopicArn ?? '');
        lines.push('Type');
        lines.push(payload.Type ?? '');
        return lines.join('\n') + '\n';
      };

      // Build a validly-signed SubscriptionConfirmation payload + matching cert.
      const signedSubPayload = () => {
        const payload: any = {
          Type: 'SubscriptionConfirmation',
          MessageId: 'sub-uuid-1234',
          TopicArn: defaultTopicArn,
          Message: 'You have chosen to subscribe',
          SubscribeURL: snsSubscribeUrl,
          Token: 'token-abc',
          Timestamp: '2024-01-01T00:00:00.000Z',
          SigningCertUrl: snsCertUrl,
        };
        payload.Signature = crypto
          .sign('sha1WithRSAEncryption', Buffer.from(buildSubSigningString(payload)), subPrivateKey)
          .toString('base64');
        return { payload, publicKey: subPublicKey };
      };

      it('confirms a validly-signed, pinned SubscriptionConfirmation', async () => {
        const { payload, publicKey } = signedSubPayload();
        vi.mocked(safeFetch).mockImplementation((url: string) =>
          Promise.resolve(
            url === snsCertUrl
              ? ({ ok: true, text: () => Promise.resolve(publicKey as string) } as any)
              : ({ ok: true } as any),
          ),
        );

        const result = await adapter.verifyWebhook(
          Buffer.from(JSON.stringify(payload)),
          { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
        );
        expect(result).toBe(true);
        expect(safeFetch).toHaveBeenCalledWith(snsSubscribeUrl, { method: 'GET' });
      });

      it('rejects wrong TopicArn (non-pinned topic)', async () => {
        const { payload } = signedSubPayload();
        payload.TopicArn = 'arn:aws:sns:us-east-1:123456789012:different-topic';

        const result = await adapter.verifyWebhook(
          Buffer.from(JSON.stringify(payload)),
          { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
        );
        expect(result).toBe(false);
      });

      it('rejects when EMAIL_WEBHOOK_SECRET is unset (fails closed)', async () => {
        delete process.env.EMAIL_WEBHOOK_SECRET;
        const { payload } = signedSubPayload();

        const result = await adapter.verifyWebhook(
          Buffer.from(JSON.stringify(payload)),
          { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
        );
        expect(result).toBe(false);
        // must not self-confirm the topic
        expect(safeFetch).not.toHaveBeenCalledWith(snsSubscribeUrl, { method: 'GET' });
      });

      it('rejects an unsigned SubscriptionConfirmation', async () => {
        const result = await adapter.verifyWebhook(
          Buffer.from(JSON.stringify({
            Type: 'SubscriptionConfirmation',
            TopicArn: defaultTopicArn,
            SubscribeURL: snsSubscribeUrl,
          })),
          { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
        );
        expect(result).toBe(false);
        expect(safeFetch).not.toHaveBeenCalledWith(snsSubscribeUrl, { method: 'GET' });
      });

      it('rejects an invalid-signature SubscriptionConfirmation', async () => {
        const { payload, publicKey } = signedSubPayload();
        payload.Signature = 'aW52YWxpZFNpZ25hdHVyZQ==';
        vi.mocked(safeFetch).mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(publicKey as string),
        } as any);

        const result = await adapter.verifyWebhook(
          Buffer.from(JSON.stringify(payload)),
          { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
        );
        expect(result).toBe(false);
        expect(safeFetch).not.toHaveBeenCalledWith(snsSubscribeUrl, { method: 'GET' });
      });

      it('rejects non-sns hostname in SubscribeURL', async () => {
        const { payload } = signedSubPayload();
        payload.SubscribeURL = 'https://evil.com/confirm';

        const result = await adapter.verifyWebhook(
          Buffer.from(JSON.stringify(payload)),
          { 'x-amz-sns-message-type': 'SubscriptionConfirmation' },
        );
        expect(result).toBe(false);
      });
    });

    describe('Notification', () => {
      // Generating a 2048-bit RSA key pair synchronously is CPU-intensive and can
      // exceed the default 5s test timeout under parallel load. Generate once for
      // the whole Notification block and reuse it across tests.
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const buildSnsSigningString = (payload: any): string => {
        const lines: string[] = [];
        lines.push('Message');
        lines.push(payload.Message ?? '');
        lines.push('MessageId');
        lines.push(payload.MessageId ?? '');
        if (payload.Subject != null) {
          lines.push('Subject');
          lines.push(payload.Subject);
        }
        lines.push('Timestamp');
        lines.push(payload.Timestamp ?? '');
        lines.push('TopicArn');
        lines.push(payload.TopicArn ?? '');
        lines.push('Type');
        lines.push(payload.Type ?? '');
        return lines.join('\n') + '\n';
      };

      it('returns false when TopicArn does not match EMAIL_WEBHOOK_SECRET', async () => {
        const rawBody = Buffer.from(JSON.stringify({
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:wrong-topic',
          Type: 'Notification',
        }));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(false);
      });

      it('returns false when EMAIL_WEBHOOK_SECRET is unset (fails closed)', async () => {
        delete process.env.EMAIL_WEBHOOK_SECRET;
        const rawBody = Buffer.from(JSON.stringify({
          TopicArn: defaultTopicArn,
          Type: 'Notification',
        }));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(false);
      });

      it('returns true when signature is valid', async () => {
        const payload = {
          Type: 'Notification',
          MessageId: 'msg-uuid-1234',
          TopicArn: defaultTopicArn,
          Message: JSON.stringify({ notificationType: 'Delivery', mail: { messageId: 'abcd' } }),
          Timestamp: '2024-01-01T00:00:00.000Z',
          SigningCertUrl: snsCertUrl,
        };

        const signingString = buildSnsSigningString(payload);
        const signature = crypto
          .sign('sha1WithRSAEncryption', Buffer.from(signingString), privateKey)
          .toString('base64');

        (payload as any).Signature = signature;

        vi.mocked(safeFetch).mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(publicKey as string),
        } as any);

        const rawBody = Buffer.from(JSON.stringify(payload));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(true);
      });

      it('handles SigningCertURL (uppercase) alias', async () => {
        const payload = {
          Type: 'Notification',
          MessageId: 'msg-uuid-1234',
          TopicArn: defaultTopicArn,
          Message: JSON.stringify({ notificationType: 'Delivery', mail: { messageId: 'abcd' } }),
          Timestamp: '2024-01-01T00:00:00.000Z',
          SigningCertURL: snsCertUrl,
        };

        const signingString = buildSnsSigningString(payload);
        const signature = crypto
          .sign('sha1WithRSAEncryption', Buffer.from(signingString), privateKey)
          .toString('base64');

        (payload as any).Signature = signature;

        vi.mocked(safeFetch).mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(publicKey as string),
        } as any);

        const rawBody = Buffer.from(JSON.stringify(payload));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(true);
      });

      it('verifies SignatureVersion 2 with RSA-SHA256', async () => {
        const payload = {
          Type: 'Notification',
          MessageId: 'msg-uuid-5678',
          TopicArn: defaultTopicArn,
          Subject: 'Test Subject',
          Message: JSON.stringify({ notificationType: 'Delivery', mail: { messageId: 'abcd' } }),
          Timestamp: '2024-01-01T00:00:00.000Z',
          SigningCertUrl: snsCertUrl,
          SignatureVersion: '2',
        };

        const signingString = buildSnsSigningString(payload);
        const signature = crypto
          .sign('RSA-SHA256', Buffer.from(signingString), privateKey)
          .toString('base64');

        (payload as any).Signature = signature;

        vi.mocked(safeFetch).mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(publicKey as string),
        } as any);

        const rawBody = Buffer.from(JSON.stringify(payload));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(true);
      });

      it('returns false when signature is invalid', async () => {
        const payload = {
          Type: 'Notification',
          MessageId: 'msg-uuid-1234',
          TopicArn: defaultTopicArn,
          Message: JSON.stringify({ notificationType: 'Delivery', mail: { messageId: 'abcd' } }),
          Timestamp: '2024-01-01T00:00:00.000Z',
          SigningCertUrl: snsCertUrl,
          Signature: 'aW52YWxpZFNpZ25hdHVyZQ==',
        };

        vi.mocked(safeFetch).mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(publicKey as string),
        } as any);

        const rawBody = Buffer.from(JSON.stringify(payload));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(false);
      });

      it('returns false when SigningCertUrl has non-sns hostname', async () => {
        const rawBody = Buffer.from(JSON.stringify({
          Type: 'Notification',
          MessageId: 'msg-1',
          TopicArn: defaultTopicArn,
          Message: 'test',
          Timestamp: '2024-01-01T00:00:00Z',
          SigningCertUrl: 'https://evil.com/cert.pem',
          Signature: 'base64sig',
        }));
        const headers = { 'x-amz-sns-message-type': 'Notification' };

        const result = await adapter.verifyWebhook(rawBody, headers);
        expect(result).toBe(false);
      });
    });

    it('returns false for unknown message types', async () => {
      const rawBody = Buffer.from(JSON.stringify({
        TopicArn: defaultTopicArn,
      }));
      const headers = { 'x-amz-sns-message-type': 'UnknownType' };

      const result = await adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(false);
    });

    it('returns false when payload is invalid JSON', async () => {
      const rawBody = Buffer.from('not-json');
      const headers = { 'x-amz-sns-message-type': 'Notification' };

      const result = await adapter.verifyWebhook(rawBody, headers);
      expect(result).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('maps Delivery to delivered', () => {
      const message = JSON.stringify({
        notificationType: 'Delivery',
        mail: {
          messageId: 'msg-001',
          destination: ['user@example.com'],
          timestamp: '2024-01-01T00:00:00Z',
        },
      });

      const rawBody = Buffer.from(JSON.stringify({ Message: message }));
      const result = adapter.parseWebhook(rawBody, {});

      expect(result).toEqual([
        {
          providerMessageId: 'msg-001',
          recipient: 'user@example.com',
          status: 'delivered',
          occurredAt: expect.any(Date),
        },
      ]);
    });

    it('maps Bounce to bounced', () => {
      const message = JSON.stringify({
        notificationType: 'Bounce',
        mail: {
          messageId: 'msg-002',
          destination: ['bad@example.com'],
          timestamp: '2024-01-01T00:00:00Z',
        },
      });

      const rawBody = Buffer.from(JSON.stringify({ Message: message }));
      const result = adapter.parseWebhook(rawBody, {});

      expect(result).toEqual([
        expect.objectContaining({
          providerMessageId: 'msg-002',
          status: 'bounced',
        }),
      ]);
    });

    it('maps Complaint to complained', () => {
      const message = JSON.stringify({
        notificationType: 'Complaint',
        mail: {
          messageId: 'msg-003',
          destination: ['user@example.com'],
          timestamp: '2024-01-01T00:00:00Z',
        },
      });

      const rawBody = Buffer.from(JSON.stringify({ Message: message }));
      const result = adapter.parseWebhook(rawBody, {});

      expect(result).toEqual([
        expect.objectContaining({
          status: 'complained',
        }),
      ]);
    });

    it('returns [] for unknown notificationType', () => {
      const message = JSON.stringify({
        notificationType: 'Rendering Failure',
        mail: {
          messageId: 'msg-004',
        },
      });

      const rawBody = Buffer.from(JSON.stringify({ Message: message }));
      const result = adapter.parseWebhook(rawBody, {});

      expect(result).toEqual([]);
    });
  });
});
