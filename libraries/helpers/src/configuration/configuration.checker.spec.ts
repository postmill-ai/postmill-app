import { describe, expect, it } from 'vitest';
import { ConfigurationChecker } from '@postmill-ai/helpers/configuration/configuration.checker';

// checkDeprecatedChannelVars: the CHANNEL_ENV_MAPPINGS vars are SUPPORTED
// (platform channel apps) and must stay silent; only truly dead legacy vars
// with no live reads warn.
describe('ConfigurationChecker.checkDeprecatedChannelVars', () => {
  const checkWith = (env: Record<string, string>) => {
    const checker = new ConfigurationChecker();
    checker.cfg = env;
    checker.checkDeprecatedChannelVars();
    return checker.getIssues();
  };

  it('warns on dead legacy vars only', () => {
    const issues = checkWith({
      DISCORD_BOT_TOKEN_ID: 'x',
      MASTODON_URL: 'https://mastodon.social',
      X_URL: 'https://x.com',
      MEWE_HOST: 'https://mewe.com',
      SLACK_SIGNING_SECRET: 'secret',
    });

    expect(issues).toHaveLength(5);
    for (const key of [
      'DISCORD_BOT_TOKEN_ID',
      'MASTODON_URL',
      'X_URL',
      'MEWE_HOST',
      'SLACK_SIGNING_SECRET',
    ]) {
      expect(issues.some((i) => i.startsWith(key + ' '))).toBe(true);
    }
  });

  it('stays silent on supported platform-app vars (CHANNEL_ENV_MAPPINGS)', () => {
    const issues = checkWith({
      X_API_KEY: 'id',
      X_API_SECRET: 'secret',
      LINKEDIN_CLIENT_ID: 'id',
      LINKEDIN_CLIENT_SECRET: 'secret',
      FACEBOOK_APP_ID: 'id',
      FACEBOOK_APP_SECRET: 'secret',
      INSTAGRAM_APP_ID: 'id',
      INSTAGRAM_APP_SECRET: 'secret',
      DISCORD_CLIENT_ID: 'id',
      DISCORD_CLIENT_SECRET: 'secret',
      SLACK_ID: 'id',
      SLACK_SECRET: 'secret',
      MASTODON_CLIENT_ID: 'id',
      MASTODON_CLIENT_SECRET: 'secret',
      TELEGRAM_TOKEN: 'token',
      REDDIT_CLIENT_ID: 'id',
      THREADS_APP_ID: 'id',
      YOUTUBE_CLIENT_ID: 'id',
      TIKTOK_CLIENT_ID: 'id',
      PINTEREST_CLIENT_ID: 'id',
      DRIBBBLE_CLIENT_ID: 'id',
    });

    expect(issues).toEqual([]);
  });

  it('stays silent when none of the dead vars are set', () => {
    expect(checkWith({})).toEqual([]);
  });
});
