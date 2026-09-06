import { describe, it, expect, vi } from 'vitest';
import { TwitchProvider } from './social.adapter';

describe('TwitchProvider.authenticate', () => {
  const client = { client_id: 'id', client_secret: 'secret' } as any;

  it('accepts the scope array Twitch returns in the token response', async () => {
    const provider = new TwitchProvider();
    (provider as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('id.twitch.tv/oauth2/token')) {
        return {
          json: async () => ({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: [
              'user:write:chat',
              'user:read:chat',
              'moderator:manage:announcements',
            ],
          }),
        };
      }
      return {
        json: async () => ({
          data: [
            {
              id: '123',
              display_name: 'Streamer',
              login: 'streamer',
              profile_image_url: '',
            },
          ],
        }),
      };
    });

    const result = await provider.authenticate(
      { code: 'x', codeVerifier: 'y' },
      client
    );

    expect(result.accessToken).toBe('at');
    expect(result.username).toBe('streamer');
  });

  it('throws the provider reason when the token exchange fails', async () => {
    const provider = new TwitchProvider();
    (provider as any).fetch = vi.fn(async () => ({
      json: async () => ({
        status: 403,
        message: 'invalid client secret',
      }),
    }));

    await expect(
      provider.authenticate({ code: 'x', codeVerifier: 'y' }, client)
    ).rejects.toThrow('Twitch token exchange failed: invalid client secret');
  });
});
