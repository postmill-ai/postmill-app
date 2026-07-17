import { describe, it, expect, vi } from 'vitest';

// F3 — Social-adapter posting contract test (Telegram).
//
// Telegram posts through the `node-telegram-bot-api` SDK (bot.sendMessage), NOT
// SocialAbstract.fetch — the api.telegram.org host and the bot-token auth ride inside the
// SDK and can't be observed from a recording fetch. We mock the SDK and assert the
// strongest available contract: the bot is constructed with the app's bot token, the
// send carries the chat id + the message text (HTML parse mode), and the returned
// releaseURL points at t.me with the message id.

const h = vi.hoisted(() => ({
  ctorTokens: [] as string[],
  sends: [] as any[],
}));

vi.mock('node-telegram-bot-api', () => ({
  default: class {
    constructor(public token: string) {
      h.ctorTokens.push(token);
    }
    async sendMessage(chatId: any, text: string, opts: any) {
      h.sends.push({ chatId, text, opts });
      return { message_id: 42 };
    }
  },
}));

import { TelegramProvider } from './social.adapter';

describe('telegram provider post() contract', () => {
  it('sends the message to the chat via the bot SDK and returns a t.me release URL', async () => {
    const provider = new TelegramProvider();

    const out = await provider.post(
      'mychannel',
      'chat-123',
      [{ id: 'p1', message: 'hello telegram world', media: [], settings: {} } as any],
      {} as any,
      { client_id: 'bot-token' } as any
    );

    // Bot constructed with the configured bot token.
    expect(h.ctorTokens).toContain('bot-token');

    // The send carries the chat id, the content, and HTML parse mode.
    const send = h.sends[0];
    expect(send.chatId).toBe('chat-123');
    expect(send.text).toBe('hello telegram world');
    expect(send.opts.parse_mode).toBe('HTML');

    expect(out[0].postId).toBe('42');
    expect(new URL(out[0].releaseURL!).host).toBe('t.me');
    expect(out[0].releaseURL).toContain('/mychannel/42');
  });
});
