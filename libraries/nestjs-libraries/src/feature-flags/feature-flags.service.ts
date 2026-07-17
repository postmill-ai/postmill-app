import { Injectable, Logger } from '@nestjs/common';

/**
 * Dev-oriented feature flags that let local developers trade functionality for
 * memory/startup speed. All flags default to **enabled** so production and CI
 * behaviour is unchanged; they must be explicitly disabled in the local shell.
 *
 * Example:
 *   DEV_DISABLE_AI=true DEV_DISABLE_MCP=true pnpm run dev:minimal
 */
export type DevFeatureFlag =
  | 'ai'
  | 'mcp'
  | 'media'
  | 'shortlinks'
  | 'email'
  | 'video'
  | 'agent'
  | 'sentry'
  | 'opentelemetry'
  | 'cron';

const ENV_MAP: Record<DevFeatureFlag, string> = {
  ai: 'DEV_DISABLE_AI',
  mcp: 'DEV_DISABLE_MCP',
  media: 'DEV_DISABLE_MEDIA',
  shortlinks: 'DEV_DISABLE_SHORTLINKS',
  email: 'DEV_DISABLE_EMAIL',
  video: 'DEV_DISABLE_VIDEO',
  agent: 'DEV_DISABLE_AGENT',
  sentry: 'DEV_DISABLE_SENTRY',
  opentelemetry: 'DEV_DISABLE_OPENTELEMETRY',
  cron: 'DEV_DISABLE_CRON',
};

@Injectable()
export class FeatureFlagsService {
  private readonly _logger = new Logger(FeatureFlagsService.name);
  private readonly _cache = new Map<DevFeatureFlag, boolean>();

  isEnabled(flag: DevFeatureFlag): boolean {
    const cached = this._cache.get(flag);
    if (cached !== undefined) return cached;

    const envName = ENV_MAP[flag];
    const raw = process.env[envName];
    // Empty string, undefined, or explicit 'false'/'0' → enabled.
    // Anything else (including bare 'true', '1', 'yes') → disabled.
    const disabled = !!raw && raw !== 'false' && raw !== '0';

    if (disabled) {
      this._logger.log(`Dev feature flag disabled: ${flag} (${envName}=${raw})`);
    }

    this._cache.set(flag, !disabled);
    return !disabled;
  }

  isDisabled(flag: DevFeatureFlag): boolean {
    return !this.isEnabled(flag);
  }
}
