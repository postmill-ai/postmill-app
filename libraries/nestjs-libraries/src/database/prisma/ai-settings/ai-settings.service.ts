import { Inject, Injectable } from '@nestjs/common';
import { AiSettingsRepository } from './ai-settings.repository';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { AIProviderAdapter } from '@gitroom/nestjs-libraries/ai/ai-provider.interface';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/provider-kernel.token';
import { ProviderKernel, DEFAULT_VERSION } from '@gitroom/provider-kernel';
import {
  UpsertBrandProfileData,
  validateBrandProfileData,
} from './brand-profile.schema';

@Injectable()
export class AiSettingsService {
  constructor(
    private _repository: AiSettingsRepository,
    private _encryption: EncryptionService,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    private _resolution: ProviderResolutionService,
  ) {}

  // ── AIProviderConfig ──

  getProviderConfigs() {
    return this._repository.getProviderConfigs();
  }

  listProviderConfigs() {
    return this._repository.listProviderConfigs();
  }

  getProviderConfigByIdentifier(identifier: string) {
    return this._repository.getProviderConfigByIdentifier(identifier);
  }

  async upsertProviderConfig(
    identifier: string,
    data: {
      enabled?: boolean;
      credentials?: Record<string, string>;
      defaultModel?: string;
      reasoningModel?: string;
      extraConfig?: Record<string, any>;
    },
  ) {
    let extraConfig: string | undefined;
    if (data.extraConfig !== undefined) {
      if (typeof data.extraConfig === 'string') {
        try {
          JSON.parse(data.extraConfig);
          extraConfig = data.extraConfig;
        } catch {
          throw new Error('extraConfig must be a valid JSON string');
        }
      } else if (typeof data.extraConfig === 'object') {
        extraConfig = JSON.stringify(data.extraConfig);
      }
    }

    const encryptedCredentials = data.credentials
      ? AuthService.fixedEncryption(JSON.stringify(data.credentials))
      : undefined;

    return this._repository.upsertProviderConfig(identifier, {
      ...data,
      credentials: encryptedCredentials,
      extraConfig,
    });
  }

  decryptProviderConfig(config: { credentials?: string | null }) {
    if (!config.credentials) return { credentials: undefined };
    try {
      return {
        credentials: JSON.parse(
          AuthService.fixedDecryption(config.credentials),
        ) as Record<string, string>,
      };
    } catch {
      return { credentials: undefined };
    }
  }

  async deleteProviderConfig(identifier: string) {
    return this._repository.deleteProviderConfig(identifier);
  }

  getEnabledProviderConfigs() {
    return this._repository.getEnabledProviderConfigs();
  }

  // ── Provider catalog helpers (A-07) ──

  private _resolveAdapter(identifier: string, version?: string): AIProviderAdapter | undefined {
    try {
      return this._resolution.resolveAI(identifier, version ? { version } : {});
    } catch {
      return undefined;
    }
  }

  private _listAdapters(): AIProviderAdapter[] {
    const seen = new Set<string>();
    const out: AIProviderAdapter[] = [];
    for (const manifest of this._kernel?.listManifests('ai') ?? []) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      const adapter = this._resolveAdapter(manifest.providerId, manifest.version);
      if (adapter) out.push(adapter);
    }
    return out;
  }

  getProviderVersionMeta(identifier: string, preferredVersion?: string) {
    const manifests = this._kernel?.versions('ai', identifier) ?? [];
    const selected = preferredVersion
      ? manifests.find((m) => m.version === preferredVersion)
      : this._kernel?.latestActive('ai', identifier)?.manifest;
    const fallback = manifests[0];
    const target = selected ?? fallback;

    return {
      version: target?.version ?? preferredVersion ?? DEFAULT_VERSION,
      status: target?.status ?? 'active',
      availableVersions: manifests.map((m) => ({
        version: m.version,
        status: m.status,
        credentialFields: m.credentialFields,
      })),
      credentialFields: target?.credentialFields,
    };
  }

  isProviderConfigured(
    adapter: AIProviderAdapter | undefined,
    config: { credentials?: string | null } | null | undefined,
  ): boolean {
    if (!adapter || !config) return false;

    try {
      const decrypted = this.decryptProviderConfig(config);
      const credentials = decrypted.credentials || {};
      return adapter.credentialFields
        .filter((field) => field.required)
        .every((field) => {
          const value = credentials[field.key];
          return typeof value === 'string' && value.trim().length > 0;
        });
    } catch {
      return false;
    }
  }

  private _isSensitiveKey(key: string): boolean {
    const SENSITIVE_KEY_PATTERNS = [
      'apikey',
      'api_key',
      'secret',
      'password',
      'token',
      'credential',
      'authorization',
      'bearer',
      'privatekey',
      'private_key',
    ];
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_KEY_PATTERNS.some((pattern) =>
      normalized.includes(pattern.replace(/[^a-z0-9]/g, '')),
    );
  }

  redactSensitive(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitive(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.entries(value).reduce((acc, [key, item]) => {
      acc[key] = this._isSensitiveKey(key)
        ? '[REDACTED]'
        : this.redactSensitive(item);
      return acc;
    }, {} as Record<string, any>);
  }

  safeJson(raw: any) {
    if (!raw) return null;
    if (typeof raw !== 'string') return this.redactSensitive(raw);
    try {
      return this.redactSensitive(JSON.parse(raw));
    } catch {
      return '[REDACTED_UNPARSEABLE_CONFIG]';
    }
  }

  async listProviderCatalog() {
    const adapters = this._listAdapters();
    const dbConfigs = await this.getProviderConfigs();
    const dbConfigMap = new Map(dbConfigs.map((c) => [c.identifier, c]));

    return adapters.map((adapter) => {
      const dbConfig = dbConfigMap.get(adapter.identifier);
      const isConfigured = this.isProviderConfigured(adapter, dbConfig);
      const meta = this.getProviderVersionMeta(adapter.identifier);

      return {
        identifier: adapter.identifier,
        name: adapter.name,
        type: adapter.type,
        capabilities: adapter.capabilities,
        privacy: adapter.privacy,
        enabled: dbConfig?.enabled || false,
        isConfigured,
        credentialFields: meta.credentialFields ?? adapter.credentialFields,
        ...meta,
      };
    });
  }

  // ── AISystemSettings (singleton) ──

  async getSystemSettings() {
    return this._repository.getSystemSettings();
  }

  private _tryParseJson(raw: string | null | undefined): any {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async getDecryptedSystemSettings() {
    const settings = await this._repository.getSystemSettings();
    if (!settings) return null;

    let secretSettings: Record<string, string> | undefined;
    if (settings.secretSettings) {
      try {
        secretSettings = JSON.parse(
          AuthService.fixedDecryption(settings.secretSettings),
        );
      } catch {
        secretSettings = undefined;
      }
    }

    return {
      ...settings,
      secretSettings,
      scopeModels: this._tryParseJson(settings.scopeModels),
      guardrailSettings: this._tryParseJson(settings.guardrailSettings),
      budgetSettings: this._tryParseJson(settings.budgetSettings),
      rateLimitSettings: this._tryParseJson(settings.rateLimitSettings),
      observability: this._tryParseJson(settings.observability),
      mcpSettings: this._tryParseJson(settings.mcpSettings),
      ragSettings: this._tryParseJson(settings.ragSettings),
    };
  }

  async upsertSystemSettings(data: Record<string, any>) {
    const processed = { ...data };

    const jsonFields = ['scopeModels', 'guardrailSettings', 'budgetSettings', 'rateLimitSettings', 'observability', 'mcpSettings', 'ragSettings'];
    for (const field of jsonFields) {
      if (processed[field] === undefined || processed[field] === null) continue;
      if (typeof processed[field] === 'object') {
        processed[field] = JSON.stringify(processed[field]);
      } else if (typeof processed[field] === 'string' && processed[field] !== '') {
        try {
          JSON.parse(processed[field]);
        } catch {
          throw new Error(`Invalid JSON in ${field}: must be valid JSON string`);
        }
      }
    }

    if (processed.secretSettings && typeof processed.secretSettings === 'object') {
      processed.secretSettings = AuthService.fixedEncryption(
        JSON.stringify(processed.secretSettings),
      );
    }

    return this._repository.upsertSystemSettings(processed);
  }

  // ── AISpendLog ──

  createSpendLog(data: {
    organizationId?: string;
    userId?: string;
    provider: string;
    model: string;
    scope: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }) {
    return this._repository.createSpendLog(data);
  }

  getSpendSummary(organizationId?: string, since?: Date) {
    return this._repository.getSpendSummary(organizationId, since);
  }

  async getUsageSummary(organizationId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [summary, monthSummary, daySummary, settings] = await Promise.all([
      this.getSpendSummary(organizationId),
      this.getSpendSummary(organizationId, startOfMonth),
      this.getSpendSummary(organizationId, startOfDay),
      this.getSystemSettings(),
    ]);

    const totalSpend = summary.reduce(
      (acc: number, s: any) => acc + (s._sum?.costUsd || 0),
      0,
    );
    const monthlySpend = monthSummary.reduce(
      (acc: number, s: any) => acc + (s._sum?.costUsd || 0),
      0,
    );
    const dailySpend = daySummary.reduce(
      (acc: number, s: any) => acc + (s._sum?.costUsd || 0),
      0,
    );

    const budgetSettings = settings?.budgetSettings
      ? this._tryParseJson(settings.budgetSettings)
      : null;

    return {
      byScope: summary,
      totalSpendUsd: totalSpend,
      monthlySpendUsd: monthlySpend,
      dailySpendUsd: dailySpend,
      budget: budgetSettings
        ? {
            monthlyCap: budgetSettings.monthlyCap ?? null,
            dailyCap: budgetSettings.dailyCap ?? null,
            remainingMonthly:
              budgetSettings.monthlyCap != null
                ? Math.max(0, budgetSettings.monthlyCap - monthlySpend)
                : null,
            remainingDaily:
              budgetSettings.dailyCap != null
                ? Math.max(0, budgetSettings.dailyCap - dailySpend)
                : null,
          }
        : null,
    };
  }

  // ── AISettingsAudit ──

  private _sanitizeAuditDetail(detail: any): any {
    const SENSITIVE_KEYS = ['apiKey', 'api_key', 'apikey', 'secret', 'password', 'token', 'credential', 'auth', 'key'];
    const isSensitiveKey = (key: string) => {
      const lowerKey = key.toLowerCase();
      return SENSITIVE_KEYS.some(sk => lowerKey === sk || lowerKey.startsWith(sk) || lowerKey.endsWith(sk));
    };
    if (Array.isArray(detail)) {
      return detail.map((item) => this._sanitizeAuditDetail(item));
    }
    if (typeof detail !== 'object' || detail === null) {
      return detail;
    }

    const sanitized: Record<string, any> = {};
    const sensitiveFieldName =
      (typeof detail.field === 'string' && isSensitiveKey(detail.field)) ||
      (typeof detail.name === 'string' && isSensitiveKey(detail.name));

    for (const [key, value] of Object.entries(detail)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (
        sensitiveFieldName &&
        ['value', 'oldValue', 'newValue', 'before', 'after', 'previous', 'next'].includes(key)
      ) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this._sanitizeAuditDetail(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  getAuditLogs(limit = 100, offset = 0) {
    return this._repository.getAuditLogs(limit, offset);
  }

  createAuditLog(data: { userId?: string; action: string; detail?: string }) {
    let sanitizedDetail: any;
    if (data.detail) {
      try {
        sanitizedDetail = this._sanitizeAuditDetail(JSON.parse(data.detail));
      } catch {
        sanitizedDetail = {
          parseError: 'invalid_json',
          raw: '[UNPARSABLE_DETAIL_REDACTED]',
        };
      }
    }
    return this._repository.createAuditLog({
      ...data,
      detail: sanitizedDetail ? JSON.stringify(sanitizedDetail) : undefined,
    });
  }

  // ── AIOrgProviderConfig ──

  getOrgProviderConfigs(organizationId: string) {
    return this._repository.getOrgProviderConfigs(organizationId);
  }

  getAllOrgIds() {
    return this._repository.getAllOrgIds();
  }

  getOrgProviderConfig(organizationId: string, identifier: string) {
    return this._repository.getOrgProviderConfig(organizationId, identifier);
  }

  async upsertOrgProviderConfig(
    organizationId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      credentials?: Record<string, string>;
      defaultModel?: string;
      reasoningModel?: string;
      extraConfig?: Record<string, any>;
    },
  ) {
    let extraConfig: string | undefined;
    if (data.extraConfig !== undefined) {
      if (typeof data.extraConfig === 'string') {
        try {
          JSON.parse(data.extraConfig);
          extraConfig = data.extraConfig;
        } catch {
          throw new Error('extraConfig must be a valid JSON string');
        }
      } else if (typeof data.extraConfig === 'object') {
        extraConfig = JSON.stringify(data.extraConfig);
      }
    }

    // 3.9: per-org AIOrgProviderConfig rows are read back at runtime by
    // OrgAiSettingsService / OrgMediaProviderSettingsService via EncryptionService,
    // so the admin write goes through the same service for symmetry. Note this is a
    // no-op in crypto terms: EncryptionService.encrypt delegates to
    // AuthService.fixedEncryption (encryption.service.ts), the same routine used for
    // the deployment-wide AIProviderConfig — both share one getEncryptionKey(), so
    // the two routes do NOT diverge even when a dedicated ENCRYPTION_KEY is set. It
    // is "same key behind two routes"; keeping this call on EncryptionService is
    // convention, not correctness.
    const encryptedCredentials = data.credentials
      ? this._encryption.encrypt(JSON.stringify(data.credentials))
      : undefined;

    return this._repository.upsertOrgProviderConfig(organizationId, identifier, {
      ...data,
      credentials: encryptedCredentials,
      extraConfig,
    });
  }

  deleteOrgProviderConfig(organizationId: string, identifier: string) {
    return this._repository.deleteOrgProviderConfig(organizationId, identifier);
  }

  // ── AIBrandProfile ──

  getBrandProfile(organizationId: string, brandId?: string) {
    return this._repository.getBrandProfile(organizationId, brandId);
  }

  async upsertBrandProfile(organizationId: string, data: unknown) {
    const validated = validateBrandProfileData(data);
    return this._repository.upsertBrandProfile(
      organizationId,
      validated as UpsertBrandProfileData,
    );
  }

  // ── AIPromptTemplate ──

  getPromptTemplates(organizationId?: string | null) {
    return this._repository.getPromptTemplates(organizationId);
  }

  upsertPromptTemplate(
    organizationId: string | null,
    key: string,
    content: string,
  ) {
    return this._repository.upsertPromptTemplate(organizationId, key, content);
  }

  deletePromptTemplate(organizationId: string | null, key: string) {
    return this._repository.deletePromptTemplate(organizationId, key);
  }

  // ── AIMediaJob ──

  createMediaJob(data: {
    organizationId: string;
    userId?: string;
    provider: string;
    operation: string;
    status?: string;
    artifactUrl?: string;
    provenance?: string;
    costUsd?: number;
    creditType?: string;
    error?: string;
    folderId?: string | null;
    model?: string | null;
    version?: string | null;
    inputJson?: string | null;
  }) {
    return this._repository.createMediaJob(data);
  }

  updateMediaJob(
    organizationId: string,
    id: string,
    data: {
      status?: string;
      artifactUrl?: string | null;
      provenance?: string;
      costUsd?: number;
      error?: string | null;
      folderId?: string | null;
      model?: string | null;
      version?: string | null;
      inputJson?: string | null;
      creditType?: string | null;
    },
  ) {
    return this._repository.updateMediaJob(organizationId, id, data);
  }

  getMediaJobs(organizationId: string, limit = 50) {
    return this._repository.getMediaJobs(organizationId, limit);
  }

  async getMediaJobsWithCounts(organizationId: string, limit = 20) {
    const [jobs, counts] = await Promise.all([
      this._repository.getMediaJobs(organizationId, limit),
      this._repository.getMediaJobStatusCounts(organizationId),
    ]);
    return { jobs, counts };
  }

  getMediaJobsByProvider(organizationId: string, provider: string, limit = 50) {
    return this._repository.getMediaJobsByProvider(organizationId, provider, limit);
  }

  getMediaJobById(organizationId: string, id: string) {
    return this._repository.getMediaJobById(organizationId, id);
  }

  // See AiSettingsRepository.getMediaJobByIdUnscoped — job-id-only entry points only.
  getMediaJobByIdUnscoped(id: string) {
    return this._repository.getMediaJobByIdUnscoped(id);
  }

  // §3.1: atomic status-transition claim — see AiSettingsRepository.claimMediaJobStatus.
  claimMediaJobStatus(organizationId: string, id: string, from: string[], to: string) {
    return this._repository.claimMediaJobStatus(organizationId, id, from, to);
  }

  getPendingMediaJobs(limit = 100) {
    return this._repository.getPendingMediaJobs(limit);
  }

  // §3.1 crash-recovery: reset jobs stranded in the transient `landing` state (a crash
  // between the completion claim and the terminal write) back to `processing`.
  reclaimStaleLandingJobs(cutoff: Date) {
    return this._repository.reclaimStaleLandingJobs(cutoff);
  }

  // ── AIPromptLibraryItem ──

  getPromptLibraryItems(organizationId: string) {
    return this._repository.getPromptLibraryItems(organizationId);
  }

  createPromptLibraryItem(data: {
    organizationId: string;
    title: string;
    content: string;
  }) {
    return this._repository.createPromptLibraryItem(data);
  }

  deletePromptLibraryItem(id: string, organizationId: string) {
    return this._repository.deletePromptLibraryItem(id, organizationId);
  }

  // ── AIContentIndex (Phase 5 RAG — wrappers will be added then) ──

  async upsertContentIndex(data: {
    organizationId: string;
    sourceType: string;
    sourceId: string;
    chunkIndex: number;
    contentHash: string;
    chunk?: string;
  }) {
    if (typeof data.contentHash !== 'string' || data.contentHash.length < 8) {
      throw new Error('contentHash must be at least 8 characters');
    }
    return this._repository.upsertContentIndex(data);
  }
}
