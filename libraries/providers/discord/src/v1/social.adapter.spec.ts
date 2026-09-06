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

describe('DiscordProvider.authenticate', () => {
  const client = { client_id: 'id', client_secret: 'secret' } as any;

  it('throws the provider reason when the token exchange fails', async () => {
    const provider = new DiscordProvider();
    (provider as any).fetch = vi.fn(async () => ({
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'Invalid "redirect_uri" in request.',
      }),
    }));

    await expect(
      provider.authenticate({ code: 'x', codeVerifier: 'y' }, client)
    ).rejects.toThrow(
      'Discord token exchange failed: Invalid "redirect_uri" in request.'
    );
  });

  it('throws an actionable error when no server was selected (no guild in token response)', async () => {
    const provider = new DiscordProvider();
    (provider as any).fetch = vi.fn(async () => ({
      json: async () => ({
        access_token: 'at',
        expires_in: 3600,
        refresh_token: 'rt',
        scope: 'identify guilds',
      }),
    }));

    await expect(
      provider.authenticate({ code: 'x', codeVerifier: 'y' }, client)
    ).rejects.toThrow('No Discord server was selected');
  });
});
