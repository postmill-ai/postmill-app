import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CommsCapability, ProviderNotFoundError } from '@postmill-ai/provider-kernel';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { CommsConfigRepository } from './comms-config.repository';
import {
  getCommsPlatformCredentials,
  getCommsPlatformDefinition,
  getTelegramPlatformWebhookSecret,
  isCommsPlatformConfigured,
} from './comms-platform-env';

export interface CommsProviderListItem {
  identifier: string;
  name: string;
  enabled: boolean;
  isConfigured: boolean;
  version: string;
  capabilities: Record<string, boolean>;
  credentialFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    help?: string;
  }>;
  credentialsSet: Record<string, boolean>;
  webhookUrl?: string;
  webhookRegistered?: boolean;
  webhookError?: string;
  setupNotes?: string;
  setupSteps?: string[];
  portalUrl?: string;
  portalLabel?: string;
  docsUrl?: string;
  webhookInstructions?: string;
  platformConnect?: 'oauth' | 'env';
  platformConfigured: boolean;
  platformWebhookUrl?: string;
}

// Internal credential keys the service manages itself — never rendered as form
// fields and never wiped by a credentials update from the UI.
const INTERNAL_CREDENTIAL_KEYS = ['webhookSecret'];

// Bot scopes requested by the comms Slack OAuth flow (DM agent chat only —
// the broader posting scopes belong to the social channel flow).
const SLACK_OAUTH_SCOPES = 'chat:write,im:write,im:history,app_mentions:read';

// Slack OAuth state → initiating org/user, Redis-bound and single-use (mirrors
// the channels `organization:${state}` binding in IntegrationManager).
const slackOAuthStateKey = (state: string) => `comms-oauth:${state}`;

@Injectable()
export class CommsConfigService {
  private readonly _logger = new Logger(CommsConfigService.name);

  constructor(
    private _repository: CommsConfigRepository,
    private _encryption: EncryptionService,
    private _resolution: ProviderResolutionService,
    private _audit: AuditService,
  ) {}

  webhookUrl(identifier: string, webhookToken: string): string {
    const base = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
    return `${base}/webhooks/comms/${identifier}/${webhookToken}`;
  }

  // The shared platform-app inbound route (per-org token segment replaced by
  // the provider name; org resolution happens per event inside).
  platformWebhookUrl(identifier: string): string {
    const base = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
    return `${base}/webhooks/comms/platform/${identifier}`;
  }

  private _resolveAdapterWith(
    identifier: string,
    credentials: Record<string, string>,
    orgId: string,
    version = 'v1',
  ): CommsCapability {
    try {
      return this._resolution.resolveComms(identifier, {
        version,
        credentials,
        orgId,
      });
    } catch (err) {
      if (
        err instanceof ProviderNotFoundError ||
        ((err as Error)?.message ?? '').includes('not found')
      ) {
        throw new BadRequestException(`Unknown comms provider: ${identifier}`);
      }
      throw err;
    }
  }

  async resolveAdapter(orgId: string, identifier: string): Promise<CommsCapability> {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    if (!config || !config.enabled) {
      throw new BadRequestException(`Comms provider "${identifier}" is not configured`);
    }
    return this._resolveAdapterWith(
      identifier,
      this._decryptCredentials(config.credentials),
      orgId,
      config.version ?? 'v1',
    );
  }

  async getProviders(orgId: string): Promise<CommsProviderListItem[]> {
    const configs = await this._repository.getByOrg(orgId);
    const seen = new Set<string>();
    const items: CommsProviderListItem[] = [];
    for (const manifest of this._resolution.listManifests('comms')) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      const config = configs.find((c) => c.identifier === manifest.providerId);
      const decrypted = this._decryptCredentials(config?.credentials);
      const visibleFields = manifest.credentialFields.filter(
        (f) => !INTERNAL_CREDENTIAL_KEYS.includes(f.key),
      );
      const extra = (config?.extraConfig ?? {}) as Record<string, unknown>;
      const platform = getCommsPlatformDefinition(manifest.providerId);
      items.push({
        identifier: manifest.providerId,
        name: manifest.displayName,
        enabled: config?.enabled ?? false,
        isConfigured: visibleFields
          .filter((f) => f.required)
          .every((f) => !!decrypted[f.key]?.trim()),
        version: config?.version ?? manifest.version,
        capabilities: (manifest.capabilities ?? {}) as Record<string, boolean>,
        credentialFields: visibleFields,
        credentialsSet: Object.fromEntries(
          visibleFields.map((f) => [f.key, !!decrypted[f.key]?.trim()]),
        ),
        ...(config
          ? {
              webhookUrl: this.webhookUrl(manifest.providerId, config.webhookToken),
              webhookRegistered: extra.webhookRegistered !== false,
              ...(typeof extra.webhookError === 'string' && extra.webhookError
                ? { webhookError: extra.webhookError }
                : {}),
            }
          : {}),
        setupNotes: manifest.setupNotes,
        ...(manifest.setupSteps ? { setupSteps: manifest.setupSteps } : {}),
        ...(manifest.portalUrl ? { portalUrl: manifest.portalUrl } : {}),
        ...(manifest.portalLabel ? { portalLabel: manifest.portalLabel } : {}),
        ...(manifest.docsUrl ? { docsUrl: manifest.docsUrl } : {}),
        ...(manifest.webhookInstructions
          ? { webhookInstructions: manifest.webhookInstructions }
          : {}),
        ...(platform
          ? { platformConnect: platform.platformConnect }
          : {}),
        platformConfigured: platform
          ? isCommsPlatformConfigured(manifest.providerId)
          : false,
        ...(platform?.manualWebhookUrl
          ? { platformWebhookUrl: this.platformWebhookUrl(manifest.providerId) }
          : {}),
      });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      credentials?: Record<string, string>;
      enabled?: boolean;
      extraConfig?: Record<string, unknown>;
    },
    userId?: string,
  ) {
    const existing = await this._repository.getByIdentifier(orgId, identifier);
    const version = this._resolution.resolveWriteVersion(
      'comms',
      identifier,
      existing?.version ?? undefined,
      existing?.version ? { currentVersion: existing.version } : undefined,
    );

    // Merge onto the stored secret set so a partial update (or an enabled-only
    // toggle) never wipes credentials — including the internal webhookSecret.
    const stored = this._decryptCredentials(existing?.credentials);
    const merged = { ...stored };
    if (data.credentials !== undefined) {
      for (const [key, value] of Object.entries(data.credentials)) {
        if (INTERNAL_CREDENTIAL_KEYS.includes(key)) continue;
        if (typeof value === 'string' && value.trim()) merged[key] = value.trim();
      }
    }

    const adapter = this._resolveAdapterWith(identifier, merged, orgId, version);

    const webhookToken = existing?.webhookToken ?? randomBytes(16).toString('hex');
    if (adapter.capabilities.webhookRegistration && !merged.webhookSecret) {
      merged.webhookSecret = randomBytes(16).toString('hex');
    }

    const extraConfig: Record<string, unknown> = {
      ...((existing?.extraConfig as Record<string, unknown>) ?? {}),
      ...(data.extraConfig ?? {}),
    };
    delete extraConfig.webhookError;

    // Provider-side registration/provisioning is best-effort: a Telegram outage
    // must not fail the save. Failures surface on the row and are retried by
    // the test endpoint.
    if (adapter.capabilities.webhookRegistration && adapter.registerWebhook) {
      try {
        await adapter.registerWebhook(
          this.webhookUrl(identifier, webhookToken),
          merged.webhookSecret,
        );
        extraConfig.webhookRegistered = true;
      } catch (err) {
        extraConfig.webhookRegistered = false;
        extraConfig.webhookError = (err as Error).message?.slice(0, 300);
        this._logger.warn(
          `Comms webhook registration failed for ${identifier} (org=${orgId})`,
        );
      }
    }
    if (adapter.provision) {
      try {
        await adapter.provision();
        extraConfig.provisioned = true;
      } catch (err) {
        extraConfig.provisioned = false;
        extraConfig.webhookError = (err as Error).message?.slice(0, 300);
        this._logger.warn(`Comms provisioning failed for ${identifier} (org=${orgId})`);
      }
    }

    const result = await this._repository.upsert(
      orgId,
      identifier,
      {
        credentials: this._encryption.encrypt(JSON.stringify(merged)),
        extraConfig: extraConfig as any,
        enabled: data.enabled,
        webhookToken,
      },
      version,
    );

    this._resolution.invalidate('comms', identifier, orgId);
    this._audit.record({
      orgId,
      userId,
      action: 'credential.rotated',
      resource: 'comms-credential',
      resourceId: result?.id,
      resourceName: identifier,
    });
    return result;
  }

  /**
   * Mint the per-org webhook URL before the first save: creates a DISABLED
   * placeholder config (empty credentials, fresh webhookToken) when none
   * exists. Idempotent — an existing row just yields its URL.
   */
  async ensureWebhookUrl(
    orgId: string,
    identifier: string,
  ): Promise<{ webhookUrl: string }> {
    // Validates the identifier against the kernel (400 on unknown providers).
    this._resolveAdapterWith(identifier, {}, orgId);
    const existing = await this._repository.getByIdentifier(orgId, identifier);
    if (existing) {
      return { webhookUrl: this.webhookUrl(identifier, existing.webhookToken) };
    }
    const webhookToken = randomBytes(16).toString('hex');
    await this._repository.upsert(orgId, identifier, {
      webhookToken,
      enabled: false,
    });
    return { webhookUrl: this.webhookUrl(identifier, webhookToken) };
  }

  /**
   * One-click connect against the platform-owned app (Discord/Telegram/LINE):
   * pull credentials from the deployment env, upsert enabled, then run the
   * provider follow-ups. Telegram's single per-bot webhook points at the
   * shared platform route, so registration uses the derived platform secret —
   * never the per-org token URL. Follow-ups are best-effort but their outcome
   * is persisted on extraConfig; a failed connection test is a 400 with the
   * verbatim provider error.
   */
  async platformConnect(orgId: string, identifier: string, userId?: string) {
    const platform = getCommsPlatformDefinition(identifier);
    if (!platform || platform.platformConnect !== 'env') {
      throw new BadRequestException(
        `Comms provider "${identifier}" does not support platform connect`,
      );
    }
    const credentials = getCommsPlatformCredentials(identifier);
    if (!credentials) {
      throw new BadRequestException(
        `The platform ${identifier} app is not configured on this deployment`,
      );
    }
    const adapter = this._resolveAdapterWith(identifier, credentials, orgId);

    const existing = await this._repository.getByIdentifier(orgId, identifier);
    const version = this._resolution.resolveWriteVersion(
      'comms',
      identifier,
      existing?.version ?? undefined,
      existing?.version ? { currentVersion: existing.version } : undefined,
    );
    const webhookToken = existing?.webhookToken ?? randomBytes(16).toString('hex');
    const extraConfig: Record<string, unknown> = {
      ...((existing?.extraConfig as Record<string, unknown>) ?? {}),
    };
    delete extraConfig.webhookError;

    if (identifier === 'telegram' && adapter.registerWebhook) {
      try {
        await adapter.registerWebhook(
          this.platformWebhookUrl('telegram'),
          getTelegramPlatformWebhookSecret()!,
        );
        extraConfig.webhookRegistered = true;
      } catch (err) {
        extraConfig.webhookRegistered = false;
        extraConfig.webhookError = (err as Error).message?.slice(0, 300);
        this._logger.warn(`Telegram platform webhook registration failed (org=${orgId})`);
      }
    }
    if (identifier === 'discord') {
      if (adapter.provision) {
        try {
          await adapter.provision();
          extraConfig.provisioned = true;
        } catch (err) {
          extraConfig.provisioned = false;
          extraConfig.webhookError = (err as Error).message?.slice(0, 300);
          this._logger.warn(`Discord platform provisioning failed (org=${orgId})`);
        }
      }
      // Capture the bot's guild ids so the shared platform route can resolve
      // this org from an interaction's guild_id. Best-effort: guild-less
      // (DM) interactions fall back to the link lookup.
      try {
        const response = await safeFetch(
          'https://discord.com/api/v10/users/@me/guilds',
          { headers: { Authorization: `Bot ${credentials.botToken}` } },
        );
        if (!response.ok) {
          throw new Error(`Discord users/@me/guilds failed: ${response.status}`);
        }
        const guilds: any = await response.json();
        extraConfig.guildIds = (Array.isArray(guilds) ? guilds : [])
          .map((g) => g?.id)
          .filter(Boolean)
          .slice(0, 200);
      } catch (err) {
        this._logger.warn(
          `Discord platform guild capture failed (org=${orgId}): ${(err as Error).message}`,
        );
      }
    }

    const result = await this._repository.upsert(
      orgId,
      identifier,
      {
        credentials: this._encryption.encrypt(JSON.stringify(credentials)),
        extraConfig: extraConfig as any,
        enabled: true,
        webhookToken,
      },
      version,
    );
    this._resolution.invalidate('comms', identifier, orgId);
    this._audit.record({
      orgId,
      userId,
      action: 'credential.rotated',
      resource: 'comms-credential',
      resourceId: result?.id,
      resourceName: identifier,
    });

    const test = (await adapter.testConnection?.()) ?? { ok: true };
    if (!test.ok) {
      // Never swallow the provider's real error into a generic message.
      this._logger.warn(
        `Comms platform connect test failed for ${identifier} (org=${orgId}): ${test.error}`,
      );
      throw new BadRequestException(test.error || 'Connection test failed');
    }
    return {
      ok: true,
      test: { ok: true, ...(test.extra ? { extra: test.extra } : {}) },
    };
  }

  /**
   * Slack comms OAuth: build the authorize URL for the platform Slack app and
   * bind the initiating org/user to the state (single-use, 1h TTL — the same
   * Redis binding the channels OAuth flow uses).
   */
  async getSlackOAuthUrl(orgId: string, userId: string): Promise<{ url: string }> {
    const clientId = process.env.SLACK_ID;
    if (!clientId || !process.env.SLACK_SECRET) {
      throw new BadRequestException(
        'The platform Slack app is not configured on this deployment',
      );
    }
    const state = randomBytes(16).toString('hex');
    await ioRedis.set(
      slackOAuthStateKey(state),
      JSON.stringify({ orgId, userId }),
      'EX',
      3600,
    );
    const url =
      `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(SLACK_OAUTH_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(this._slackOAuthRedirectUri())}` +
      `&state=${state}`;
    return { url };
  }

  /**
   * Slack comms OAuth callback: validate + consume the state, exchange the
   * code, and store the bot token + env signing secret on the org's Slack
   * comms config (enabled, teamId captured for platform-route org resolution).
   */
  async handleSlackOAuthCallback(code: string, state: string): Promise<void> {
    const raw = await ioRedis.get(slackOAuthStateKey(state));
    if (!raw) {
      throw new BadRequestException('Invalid or expired state');
    }
    await ioRedis.del(slackOAuthStateKey(state));
    const { orgId, userId } = JSON.parse(raw) as { orgId: string; userId: string };

    const clientId = process.env.SLACK_ID;
    const clientSecret = process.env.SLACK_SECRET;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!clientId || !clientSecret || !signingSecret) {
      throw new BadRequestException(
        'The platform Slack app is not configured on this deployment',
      );
    }

    const response = await safeFetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: this._slackOAuthRedirectUri(),
      }).toString(),
    });
    const json: any = await response.json();
    if (!json?.ok || !json.access_token) {
      throw new BadRequestException(
        `Slack authorization failed: ${json?.error || response.status}`,
      );
    }

    await this.upsert(
      orgId,
      'slack',
      {
        credentials: { botToken: json.access_token, signingSecret },
        enabled: true,
        ...(json.team?.id ? { extraConfig: { teamId: String(json.team.id) } } : {}),
      },
      userId,
    );
  }

  private _slackOAuthRedirectUri(): string {
    const base = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
    return `${base}/settings/comms/oauth/slack/callback`;
  }

  async test(orgId: string, identifier: string) {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    if (!config) {
      throw new BadRequestException(`Comms provider "${identifier}" is not configured`);
    }
    const credentials = this._decryptCredentials(config.credentials);
    const adapter = this._resolveAdapterWith(
      identifier,
      credentials,
      orgId,
      config.version ?? 'v1',
    );

    const result = (await adapter.testConnection?.()) ?? { ok: true };

    const extraConfig: Record<string, unknown> = {
      ...((config.extraConfig as Record<string, unknown>) ?? {}),
      ...(result.ok && result.extra ? result.extra : {}),
    };
    // Re-attempt a pending webhook registration / provisioning on test.
    if (result.ok) {
      delete extraConfig.webhookError;
      if (
        adapter.capabilities.webhookRegistration &&
        adapter.registerWebhook &&
        extraConfig.webhookRegistered === false &&
        credentials.webhookSecret
      ) {
        try {
          await adapter.registerWebhook(
            this.webhookUrl(identifier, config.webhookToken),
            credentials.webhookSecret,
          );
          extraConfig.webhookRegistered = true;
        } catch (err) {
          extraConfig.webhookRegistered = false;
          extraConfig.webhookError = (err as Error).message?.slice(0, 300);
        }
      }
      if (adapter.provision && extraConfig.provisioned === false) {
        try {
          await adapter.provision();
          extraConfig.provisioned = true;
        } catch (err) {
          extraConfig.provisioned = false;
          extraConfig.webhookError = (err as Error).message?.slice(0, 300);
        }
      }
    }
    await this._repository.upsert(orgId, identifier, { extraConfig: extraConfig as any });
    return { ok: result.ok, ...(result.error ? { error: result.error } : {}) };
  }

  async delete(orgId: string, identifier: string, userId?: string) {
    const result = await this._repository.delete(orgId, identifier);
    this._resolution.invalidate('comms', identifier, orgId);
    this._audit.record({
      orgId,
      userId,
      action: 'credential.deleted',
      resource: 'comms-credential',
      resourceName: identifier,
    });
    return result;
  }

  private _decryptCredentials(
    encrypted: string | null | undefined,
  ): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(this._encryption.decrypt(encrypted));
    } catch {
      this._logger.warn('Failed to decrypt comms provider credentials');
      return {};
    }
  }
}
