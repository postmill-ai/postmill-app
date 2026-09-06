import { describe, it, expect, vi } from 'vitest';
import { TelegramProvider } from './social.adapter';

describe('TelegramProvider.analytics', () => {
  it('logs a warning and returns [] when the member-count call throws', async () => {
    const provider = new TelegramProvider();
    (provider as any).createBot = vi.fn(() => ({
      getChatMemberCount: vi.fn(async () => {
        throw new Error('boom');
      }),
    }));
    const warn = vi
      .spyOn((provider as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await provider.analytics('chat-id', 'token', 0, {
      client_id: 'bot-token',
    } as any);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Telegram analytics failed');
    // Security 3AK: no token/body content in the logged message.
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).not.toContain('bot-token');
  });
});

describe('TelegramProvider.getBotId', () => {
  const makeProvider = (bot: Record<string, unknown>) => {
    const provider = new TelegramProvider();
    (provider as any).createBot = vi.fn(() => bot);
    return provider;
  };

  it('DM misfire: guides the user and keeps polling instead of connecting the private chat', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 9 }));
    const provider = makeProvider({
      getUpdates: vi.fn(async () => [
        {
          update_id: 100,
          message: {
            message_id: 4,
            text: '/connect ab12',
            chat: { id: 8861130977, type: 'private' },
          },
        },
      ]),
      sendMessage,
    });

    const result = await provider.getBotId({ word: 'ab12' });

    // No chatId — the connect must not complete against a private DM.
    expect(result).toEqual({ lastChatId: 101 });
    expect(sendMessage).toHaveBeenCalledWith(
      8861130977,
      expect.stringContaining('in your channel or group')
    );
  });

  it('channel_post match returns the chat id', async () => {
    const provider = makeProvider({
      getUpdates: vi.fn(async () => [
        {
          update_id: 100,
          channel_post: {
            message_id: 7,
            text: '/connect ab12',
            chat: { id: -1001234567890, type: 'channel' },
          },
        },
      ]),
      getMe: vi.fn(async () => ({ id: 42 })),
      getChatMember: vi.fn(async () => ({
        status: 'administrator',
        can_delete_messages: true,
      })),
      deleteMessage: vi.fn(async () => true),
      sendMessage: vi.fn(async () => ({ message_id: 8 })),
    });

    const result = await provider.getBotId({ word: 'ab12' });

    expect(result).toEqual({ chatId: -1001234567890 });
  });
});

describe('TelegramProvider.post media resolution', () => {
  it('maps local frontend-URL uploads to the file on disk (Bot API needs a real upload)', async () => {
    const savedFrontend = process.env.FRONTEND_URL;
    const savedUpload = process.env.UPLOAD_DIRECTORY;
    process.env.FRONTEND_URL = 'https://app.postmill.ai';
    process.env.UPLOAD_DIRECTORY = '/srv/uploads';
    try {
      const sendPhoto = vi.fn(async () => ({ message_id: 11 }));
      const provider = new TelegramProvider();
      (provider as any).createBot = vi.fn(() => ({ sendPhoto }));

      const result = await provider.post(
        'chan',
        '-1001',
        [
          {
            id: 'p1',
            message: 'hello',
            media: [
              {
                id: 'm1',
                path: 'https://app.postmill.ai/uploads/org/2026/09/04/pic.jpg',
              },
            ],
          } as any,
        ],
        {} as any,
        { client_id: 'bot-token' } as any
      );

      // Disk path, not the stripped "/uploads/..." that 400s with
      // "URL host is empty".
      expect(sendPhoto.mock.calls[0][1]).toBe('/srv/uploads/org/2026/09/04/pic.jpg');
      expect(result[0].releaseURL).toBe('https://t.me/chan/11');
    } finally {
      process.env.FRONTEND_URL = savedFrontend;
      process.env.UPLOAD_DIRECTORY = savedUpload;
    }
  });

  it('passes remote storage URLs through untouched', async () => {
    const sendPhoto = vi.fn(async () => ({ message_id: 12 }));
    const provider = new TelegramProvider();
    (provider as any).createBot = vi.fn(() => ({ sendPhoto }));

    await provider.post(
      'chan',
      '-1001',
      [
        {
          id: 'p1',
          message: 'hello',
          media: [{ id: 'm1', path: 'https://cdn.example.com/x/pic.jpg' }],
        } as any,
      ],
      {} as any,
      { client_id: 'bot-token' } as any
    );

    expect(sendPhoto.mock.calls[0][1]).toBe('https://cdn.example.com/x/pic.jpg');
  });
});

describe('TelegramProvider.authenticate', () => {
  it('accepts the platform env-app credential shape (token, not client_id)', async () => {
    const provider = new TelegramProvider();
    (provider as any).createBot = vi.fn(() => ({
      getChat: vi.fn(async () => ({
        id: -1001234567890,
        title: 'Postmill AI',
        username: 'postmill_ai',
      })),
    }));

    // Env-app resolution (TELEGRAM_TOKEN) surfaces the bot token as `token`
    // with an empty client_id — authenticate must not EFATAL on it.
    const result = await provider.authenticate(
      { code: '-1001234567890', codeVerifier: '' },
      { client_id: '', token: 'env-bot-token' } as any
    );

    expect((result as any).id).toBe('postmill_ai');
    expect((result as any).accessToken).toBe('-1001234567890');
  });
});
