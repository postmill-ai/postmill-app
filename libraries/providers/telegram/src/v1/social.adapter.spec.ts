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
