import { describe, it, expect, vi } from 'vitest';
import { DiscordProvider } from './social.adapter';

describe('DiscordProvider.analytics', () => {
  it('logs a warning and returns [] when the fetch throws', async () => {
    const provider = new DiscordProvider();
    (provider as any).fetch = vi.fn(async () => {
      throw new Error('boom');
    });
    const warn = vi
      .spyOn((provider as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await provider.analytics('guild-id', 'token', 0, {
      token: 'bot-token',
    } as any);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Discord analytics failed');
    // Security 3AK: no token/body content in the logged message.
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).not.toContain('bot-token');
  });
});
