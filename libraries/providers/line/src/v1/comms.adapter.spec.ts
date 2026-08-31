import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { LineCommsAdapter, lineCommsModule } from './comms.adapter';

const fetchMock = vi.fn();
const ctx = {
  credentials: { channelAccessToken: 'line-token', channelSecret: 'line-secret' },
  fetch: fetchMock,
} as any;

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

const signBody = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64');

describe('LineCommsAdapter', () => {
  let adapter: LineCommsAdapter;

  beforeEach(() => {
    adapter = new LineCommsAdapter(ctx);
    vi.clearAllMocks();
  });

  it('declares its manifest', () => {
    expect(lineCommsModule.manifest.domain).toBe('comms');
    expect(lineCommsModule.manifest.providerId).toBe('line');
  });

  describe('verifyWebhook', () => {
    const body = JSON.stringify({ events: [] });

    it('accepts a valid base64 HMAC signature', () => {
      expect(
        adapter.verifyWebhook(Buffer.from(body), {
          'x-line-signature': signBody('line-secret', body),
        }),
      ).toBe(true);
    });

    it('rejects a bad signature or missing header', () => {
      expect(
        adapter.verifyWebhook(Buffer.from(body), {
          'x-line-signature': signBody('other-secret', body),
        }),
      ).toBe(false);
      expect(adapter.verifyWebhook(Buffer.from(body), {})).toBe(false);
    });
  });

  describe('parseInbound', () => {
    it('maps text message events', () => {
      const messages = adapter.parseInbound(
        Buffer.from(
          JSON.stringify({
            events: [
              {
                type: 'message',
                webhookEventId: 'W1',
                source: { userId: 'Uline1' },
                message: { id: 'M1', type: 'text', text: 'hello' },
              },
              { type: 'follow', source: { userId: 'Uline2' } },
            ],
          }),
        ),
        {},
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        kind: 'message',
        externalUserId: 'Uline1',
        text: 'hello',
        messageId: 'M1',
      });
    });

    it('returns ignore when no usable events', () => {
      expect(
        adapter.parseInbound(Buffer.from(JSON.stringify({ events: [] })), {})[0].kind,
      ).toBe('ignore');
    });
  });

  it('sends a 1:1 push message (not broadcast)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const result = await adapter.sendDirectMessage({
      externalUserId: 'Uline1',
      text: 'hi',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('/message/push');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      to: 'Uline1',
      messages: [{ type: 'text', text: 'hi' }],
    });
    expect(result).toEqual({ externalChannelId: 'Uline1' });
  });

  it('throws on a push failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'invalid token' }, 401));
    await expect(
      adapter.sendDirectMessage({ externalUserId: 'U1', text: 'x' }),
    ).rejects.toThrow('401');
  });
});
