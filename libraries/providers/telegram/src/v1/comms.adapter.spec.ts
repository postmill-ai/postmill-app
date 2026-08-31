import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramCommsAdapter, telegramCommsModule } from './comms.adapter';

const fetchMock = vi.fn();
const ctx = {
  credentials: { botToken: '123:AA', webhookSecret: 'hook-secret' },
  fetch: fetchMock,
} as any;

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any;

describe('TelegramCommsAdapter', () => {
  let adapter: TelegramCommsAdapter;

  beforeEach(() => {
    adapter = new TelegramCommsAdapter(ctx);
    vi.clearAllMocks();
  });

  it('declares its manifest', () => {
    expect(telegramCommsModule.manifest.domain).toBe('comms');
    expect(telegramCommsModule.manifest.providerId).toBe('telegram');
    expect(adapter.capabilities.webhookRegistration).toBe(true);
  });

  describe('verifyWebhook', () => {
    it('accepts the matching secret token header', () => {
      expect(
        adapter.verifyWebhook(Buffer.from('{}'), {
          'x-telegram-bot-api-secret-token': 'hook-secret',
        }),
      ).toBe(true);
    });

    it('rejects a wrong or missing secret token', () => {
      expect(
        adapter.verifyWebhook(Buffer.from('{}'), {
          'x-telegram-bot-api-secret-token': 'other',
        }),
      ).toBe(false);
      expect(adapter.verifyWebhook(Buffer.from('{}'), {})).toBe(false);
    });
  });

  describe('parseInbound', () => {
    it('maps a text message update', () => {
      const [msg] = adapter.parseInbound(
        Buffer.from(
          JSON.stringify({
            update_id: 5,
            message: {
              message_id: 42,
              from: { is_bot: false },
              chat: { id: 777 },
              text: 'hello',
            },
          }),
        ),
        {},
      );
      expect(msg).toMatchObject({
        kind: 'message',
        externalUserId: '777',
        externalChannelId: '777',
        text: 'hello',
        messageId: '777:42',
      });
    });

    it('ignores bot messages and non-text updates', () => {
      const bot = adapter.parseInbound(
        Buffer.from(
          JSON.stringify({
            message: { message_id: 1, from: { is_bot: true }, chat: { id: 1 }, text: 'x' },
          }),
        ),
        {},
      );
      expect(bot[0].kind).toBe('ignore');
      const sticker = adapter.parseInbound(
        Buffer.from(JSON.stringify({ message: { message_id: 2, chat: { id: 1 } } })),
        {},
      );
      expect(sticker[0].kind).toBe('ignore');
    });
  });

  it('sends a DM via sendMessage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, result: { message_id: 7 } }),
    );
    const result = await adapter.sendDirectMessage({
      externalUserId: '777',
      text: 'hi',
      link: 'https://app.example/x',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('/sendMessage');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      chat_id: '777',
      text: 'hi\nhttps://app.example/x',
    });
    expect(result).toEqual({ messageId: '7', externalChannelId: '777' });
  });

  it('registers the webhook with the secret token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: true }));
    await adapter.registerWebhook('https://backend/webhooks/comms/telegram/tok', 's3cret');
    expect(fetchMock.mock.calls[0][0]).toContain('/setWebhook');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      url: 'https://backend/webhooks/comms/telegram/tok',
      secret_token: 's3cret',
    });
  });

  it('throws on a Telegram error payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, description: 'Unauthorized' }),
    );
    await expect(
      adapter.sendDirectMessage({ externalUserId: '1', text: 'x' }),
    ).rejects.toThrow('Unauthorized');
  });
});
