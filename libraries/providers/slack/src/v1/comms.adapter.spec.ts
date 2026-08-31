import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { SlackCommsAdapter, slackCommsModule } from './comms.adapter';

const fetchMock = vi.fn();
const ctx = {
  credentials: { botToken: 'xoxb-test', signingSecret: 'sig-secret' },
  fetch: fetchMock,
} as any;

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

const sign = (secret: string, timestamp: string, body: string) =>
  `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;

describe('SlackCommsAdapter', () => {
  let adapter: SlackCommsAdapter;

  beforeEach(() => {
    adapter = new SlackCommsAdapter(ctx);
    vi.clearAllMocks();
  });

  it('declares its manifest and required capability', () => {
    expect(slackCommsModule.manifest.domain).toBe('comms');
    expect(slackCommsModule.manifest.providerId).toBe('slack');
    expect(slackCommsModule.manifest.version).toBe('v1');
    expect(adapter.capabilities.webhookInbound).toBe(true);
    expect(adapter.capabilities.pollInbound).toBe(false);
  });

  describe('verifyWebhook', () => {
    const body = Buffer.from('{"type":"event_callback"}');

    it('accepts a valid signature', () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const headers = {
        'x-slack-request-timestamp': ts,
        'x-slack-signature': sign('sig-secret', ts, body.toString()),
      };
      expect(adapter.verifyWebhook(body, headers)).toBe(true);
    });

    it('rejects a bad signature', () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const headers = {
        'x-slack-request-timestamp': ts,
        'x-slack-signature': sign('wrong-secret', ts, body.toString()),
      };
      expect(adapter.verifyWebhook(body, headers)).toBe(false);
    });

    it('rejects a stale timestamp (replay guard)', () => {
      const ts = String(Math.floor(Date.now() / 1000) - 3600);
      const headers = {
        'x-slack-request-timestamp': ts,
        'x-slack-signature': sign('sig-secret', ts, body.toString()),
      };
      expect(adapter.verifyWebhook(body, headers)).toBe(false);
    });

    it('rejects missing headers', () => {
      expect(adapter.verifyWebhook(body, {})).toBe(false);
    });
  });

  describe('parseInbound', () => {
    it('answers url_verification with the challenge', () => {
      const [msg] = adapter.parseInbound(
        Buffer.from(JSON.stringify({ type: 'url_verification', challenge: 'abc' })),
        {},
      );
      expect(msg.kind).toBe('challenge');
      expect(msg.ackResponse).toEqual({ challenge: 'abc' });
    });

    it('maps a DM event to a message', () => {
      const [msg] = adapter.parseInbound(
        Buffer.from(
          JSON.stringify({
            type: 'event_callback',
            event_id: 'Ev123',
            event: { type: 'message', user: 'U1', channel: 'D1', text: 'hello' },
          }),
        ),
        {},
      );
      expect(msg).toMatchObject({
        kind: 'message',
        externalUserId: 'U1',
        externalChannelId: 'D1',
        text: 'hello',
        messageId: 'Ev123',
      });
    });

    it('ignores bot echoes and subtypes', () => {
      for (const event of [
        { type: 'message', bot_id: 'B1', channel: 'D1', text: 'echo' },
        { type: 'message', subtype: 'message_changed', user: 'U1', channel: 'D1', text: 'x' },
      ]) {
        const [msg] = adapter.parseInbound(
          Buffer.from(JSON.stringify({ type: 'event_callback', event })),
          {},
        );
        expect(msg.kind).toBe('ignore');
      }
    });

    it('ignores unparseable bodies', () => {
      expect(adapter.parseInbound(Buffer.from('not-json'), {})[0].kind).toBe('ignore');
    });
  });

  describe('sendDirectMessage', () => {
    it('opens a DM channel when none is known, then posts', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ ok: true, channel: { id: 'D9' } }))
        .mockResolvedValueOnce(jsonResponse({ ok: true, ts: '1.2', channel: 'D9' }));
      const result = await adapter.sendDirectMessage({
        externalUserId: 'U1',
        text: 'hi',
      });
      expect(fetchMock.mock.calls[0][0]).toContain('conversations.open');
      expect(fetchMock.mock.calls[1][0]).toContain('chat.postMessage');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
        channel: 'D9',
        text: 'hi',
      });
      expect(result).toEqual({ messageId: '1.2', externalChannelId: 'D9' });
    });

    it('reuses a known channel and appends the link', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, ts: '9.9', channel: 'D9' }));
      await adapter.sendDirectMessage({
        externalUserId: 'U1',
        externalChannelId: 'D9',
        text: 'hi',
        link: 'https://app.example/x',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toBe(
        'hi\nhttps://app.example/x',
      );
    });

    it('throws on a Slack error payload', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'channel_not_found' }));
      await expect(
        adapter.sendDirectMessage({ externalUserId: 'U1', externalChannelId: 'D9', text: 'x' }),
      ).rejects.toThrow('channel_not_found');
    });
  });
});
