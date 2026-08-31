import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CommsCapability, ProviderNotFoundError } from '@postmill-ai/provider-kernel';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { CommsConfigRepository } from './comms-config.repository';

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
}

// Internal credential keys the service manages itself — never rendered as form
// fields and never wiped by a credentials update from the UI.
const INTERNAL_CREDENTIAL_KEYS = ['webhookSecret'];

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
      });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: { credentials?: Record<string, string>; enabled?: boolean },
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
