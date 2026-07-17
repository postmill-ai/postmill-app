import { readFileSync, existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

export class ConfigurationChecker {
  cfg: dotenv.DotenvParseOutput;
  issues: string[] = [];
  // Fatal issues are a strict subset of misconfigurations that should refuse a
  // production boot (see main.ts). They are ALSO mirrored into `issues` so the
  // existing warning surface still lists them; `getFatalIssues()`/`hasFatalIssues()`
  // expose just the boot-blocking set.
  fatalIssues: string[] = [];

  readEnvFromFile() {
    const envFile = resolve(__dirname, '../../../.env');

    if (!existsSync(envFile)) {
      console.error('Env file not found!: ', envFile);
      return;
    }

    const handle = readFileSync(envFile, 'utf-8');

    this.cfg = dotenv.parse(handle);
  }

  readEnvFromProcess() {
    this.cfg = process.env;
  }

  check() {
    this.checkDatabaseServers();
    this.checkNonEmpty('JWT_SECRET');
    this.checkIsValidUrl('MAIN_URL');
    this.checkIsValidUrl('FRONTEND_URL');
    this.checkIsValidUrl('NEXT_PUBLIC_BACKEND_URL');
    this.checkIsValidUrl('BACKEND_INTERNAL_URL');
    this.checkInngest();
    this.checkInngestUrl();
    this.checkDeprecatedStorageVars();
    this.checkDeprecatedChannelVars();
    this.checkDeprecatedAiVars();
    this.checkEncryptionKey();
    this.checkFatal();
  }

  // The boot-blocking subset. A missing/invalid value here should stop a production
  // start (main.ts exits non-zero). Each fatal is also pushed to `issues` so it shows
  // in the normal warning list too.
  checkFatal() {
    const jwt = this.get('JWT_SECRET');
    if (!jwt) {
      this.pushFatal('JWT_SECRET is not set — required to sign/verify auth tokens.');
    } else if (jwt.length < 32) {
      // Non-fatal WARNING only: a short secret is weaker but functional, and existing
      // deployments boot with it today. Making it fatal would (a) take down a healthy
      // deployment on upgrade and (b) force lengthening JWT_SECRET, which rotates the
      // ENCRYPTION_KEY derived from it and breaks decryption of at-rest secrets. Warn,
      // don't kill boot.
      this.issues.push(
        'JWT_SECRET is shorter than 32 characters — consider a longer signing key (note: changing it rotates the derived ENCRYPTION_KEY).'
      );
    }

    if (!this.get('DATABASE_URL')) {
      this.pushFatal('DATABASE_URL is not set — the backend cannot reach its database.');
    }

    // FRONTEND_URL is the canonical public URL (MAIN_URL is an optional alias used for an
    // extra CORS origin). Require at least one to be present.
    if (!this.get('FRONTEND_URL') && !this.get('MAIN_URL')) {
      this.pushFatal('Neither FRONTEND_URL nor MAIN_URL is set — set the public app URL.');
    }

    // Inngest keys are mandatory ONLY when Inngest is actually enabled (USE_INNGEST=true)
    // AND we are not pointed at a local dev server (INNGEST_DEV=1). Deployments that don't
    // use Inngest (USE_INNGEST unset/false) are fully supported and must still boot — gating
    // on INNGEST_DEV alone would wrongly down every non-Inngest production deployment.
    if (this.get('USE_INNGEST') === 'true' && this.get('INNGEST_DEV') !== '1') {
      if (!this.get('INNGEST_EVENT_KEY')) {
        this.pushFatal(
          'INNGEST_EVENT_KEY is not set — required when USE_INNGEST=true and INNGEST_DEV is not "1".'
        );
      }
      if (!this.get('INNGEST_SIGNING_KEY')) {
        this.pushFatal(
          'INNGEST_SIGNING_KEY is not set — required when USE_INNGEST=true and INNGEST_DEV is not "1".'
        );
      }
    }
  }

  pushFatal(message: string) {
    this.fatalIssues.push(message);
    this.issues.push(message);
  }

  checkEncryptionKey() {
    if (!this.get('ENCRYPTION_KEY')) {
      this.issues.push(
        'ENCRYPTION_KEY not set — at-rest secrets are keyed from JWT_SECRET. ' +
          'Set a dedicated 32-byte key (base64 or hex) for production so rotating ' +
          'JWT_SECRET does not invalidate every stored ciphertext.',
      );
    }
  }

  checkInngest() {
    const devMode = this.get('INNGEST_DEV') === '1';

    if (!devMode) {
      this.checkNonEmpty('INNGEST_EVENT_KEY', 'Required when INNGEST_DEV is not set.');
      this.checkNonEmpty('INNGEST_SIGNING_KEY', 'Required when INNGEST_DEV is not set.');
    }

    const fallback = this.get('INNGEST_SIGNING_KEY_FALLBACK');
    const primary = this.get('INNGEST_SIGNING_KEY');
    if (fallback && !primary) {
      this.issues.push('INNGEST_SIGNING_KEY_FALLBACK is set but INNGEST_SIGNING_KEY is empty. Set the primary key first.');
    }
  }

  checkInngestUrl() {
    const urlVars = ['INNGEST_BASE_URL', 'INNGEST_SERVE_ORIGIN'];
    for (const key of urlVars) {
      const value = this.get(key);
      if (!value) continue;
      try {
        new URL(value);
      } catch (error) {
        this.issues.push(key + ' is not a valid URL');
      }
      if (value.endsWith('/')) {
        this.issues.push(key + ' should not end with /');
      }
    }

    const path = this.get('INNGEST_SERVE_PATH');
    if (path && !path.startsWith('/')) {
      this.issues.push('INNGEST_SERVE_PATH must start with /');
    }
  }

  checkDeprecatedStorageVars() {
    const deprecatedStorageVars = [
      'STORAGE_PROVIDER',
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_ACCESS_KEY',
      'CLOUDFLARE_SECRET_ACCESS_KEY',
      'CLOUDFLARE_BUCKETNAME',
      'CLOUDFLARE_BUCKET_URL',
      'CLOUDFLARE_REGION',
    ];

    for (const key of deprecatedStorageVars) {
      if (this.get(key)) {
        this.issues.push(key + ' is deprecated. Use per-tenant storage config instead (Settings → Storage tab).');
      }
    }
  }

  checkDeprecatedChannelVars() {
    const deprecatedChannelVars = [
      'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET',
      'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET',
      'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
      'THREADS_APP_ID', 'THREADS_APP_SECRET',
      'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET',
      'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET',
      'TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET',
      'PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET',
      'DRIBBBLE_CLIENT_ID', 'DRIBBBLE_CLIENT_SECRET',
      'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN_ID',
      'SLACK_ID', 'SLACK_SECRET', 'SLACK_SIGNING_SECRET',
      'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET',
      'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET',
      'BEEHIIVE_API_KEY', 'BEEHIIVE_PUBLICATION_ID',
      'X_API_KEY', 'X_API_SECRET',
    ];

    for (const key of deprecatedChannelVars) {
      if (this.get(key)) {
        this.issues.push(key + ' is deprecated. Use per-tenant channel config instead (Settings → Channels tab).');
      }
    }
  }

  checkDeprecatedAiVars() {
    if (this.get('OPENAI_API_KEY')) {
      this.issues.push('OPENAI_API_KEY is deprecated. Use per-tenant AI config instead (Settings → AI tab).');
    }
  }

  checkNonEmpty(key: string, description?: string): boolean {
    const v = this.get(key);

    if (!description) {
      description = '';
    }

    if (!v) {
      this.issues.push(key + ' not set. ' + description);
      return false;
    }

    if (v.length === 0) {
      this.issues.push(key + ' is empty.' + description);
      return false;
    }

    return true;
  }

  get(key: string): string | undefined {
    return this.cfg[key as keyof typeof this.cfg];
  }

  checkDatabaseServers() {
    this.checkRedis();
    this.checkIsValidUrl('DATABASE_URL');
  }

  checkRedis() {
    if (!this.cfg.REDIS_URL) {
      this.issues.push('REDIS_URL not set');
      return;
    }

    try {
      const redisUrl = new URL(this.cfg.REDIS_URL);

      if (redisUrl.protocol !== 'redis:' && redisUrl.protocol !== 'rediss:') {
        this.issues.push('REDIS_URL must start with redis:// or rediss://');
      }
    } catch (error) {
      this.issues.push('REDIS_URL is not a valid URL');
    }
  }

  checkIsValidUrl(key: string) {
    if (!this.checkNonEmpty(key)) {
      return;
    }

    const urlString = this.get(key);

    try {
      new URL(urlString);
    } catch (error) {
      this.issues.push(key + ' is not a valid URL');
    }

    if (urlString.endsWith('/')) {
      this.issues.push(key + ' should not end with /');
    }
  }

  hasIssues() {
    return this.issues.length > 0;
  }

  hasFatalIssues() {
    return this.fatalIssues.length > 0;
  }

  getFatalIssues() {
    return this.fatalIssues;
  }

  getIssues() {
    return this.issues;
  }

  getIssuesCount() {
    return this.issues.length;
  }
}
