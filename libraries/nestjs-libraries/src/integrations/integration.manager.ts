import 'reflect-metadata';

import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SocialProvider,
  SocialAbstract,
  ProviderKernel,
  ChannelSetupDescriptor,
  normalizeExternalInstanceUrl,
} from '@postmill-ai/provider-kernel';
import { PROVIDER_KERNEL } from '@postmill-ai/nestjs-libraries/providers/providers.module';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { OrgProviderConfigManager } from '@postmill-ai/nestjs-libraries/integrations/org-provider-config.manager';
import { ProviderNotConfiguredError } from '@postmill-ai/nestjs-libraries/integrations/provider-not-configured.error';
import {
  getEnvClientInfo,
  isEnvEnabled,
} from '@postmill-ai/nestjs-libraries/integrations/channel-env-credentials';
import { IntegrationRepository } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.repository';
import { RefreshIntegrationService } from '@postmill-ai/nestjs-libraries/integrations/refresh.integration.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { RefreshToken } from '@postmill-ai/nestjs-libraries/integrations/social.abstract';
import { timer } from '@postmill-ai/helpers/utils/timer';
import {
  PROVIDER_CAPABILITIES,
  ProviderCapability,
} from '@postmill-ai/nestjs-libraries/integrations/social/provider-capabilities';

@Injectable()
export class IntegrationManager {
  private readonly _logger = new Logger(IntegrationManager.name);

  constructor(
    private _orgProviderConfigManager: OrgProviderConfigManager,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    private _providerResolutionService: ProviderResolutionService,
    private _integrationRepository: IntegrationRepository,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
  ) {}

  // Raw social provider singletons, sourced through ProviderResolutionService so
  // the org's pinned version is respected. The kernel's `create()` returns a
  // credential-mapping bridge; enumeration + dynamic dispatch read the underlying
  // `rawProvider` singleton so decorator metadata (`@Plug`, `@Rules`, `@Tool`)
  // and custom methods remain accessible.
  getSocialProviders(): Array<SocialAbstract & SocialProvider> {
    const seen = new Set<string>();
    const list: Array<SocialAbstract & SocialProvider> = [];
    for (const manifest of this._kernel.listManifests('social')) {
      if (seen.has(manifest.providerId)) {
        continue;
      }
      try {
        const resolved = this._providerResolutionService.resolveProvider<SocialProvider>(
          'social',
          manifest.providerId,
          { version: manifest.version },
        );
        const raw = (resolved.capability as any).rawProvider as
          | (SocialAbstract & SocialProvider)
          | undefined;
        if (!raw) {
          continue;
        }
        seen.add(manifest.providerId);
        list.push(raw);
      } catch (err) {
        // 1.3: enumeration must be resilient — a retired/unknown version must
        // not abort the whole provider list.
        this._logger.debug(
          `Skipping social provider ${manifest.providerId}@${manifest.version}: ${(err as Error).message}`,
        );
      }
    }
    return list;
  }

  async getAllIntegrations(orgId?: string) {
    // The channel picker always lists the full catalog: every registered
    // social provider shows up, whether or not any credentials exist yet.
    // `platformConfigured` tells the frontend which tiles offer one-click
    // Connect (platform OAuth app in the deployment env) vs. the BYO-app
    // credential form. The org's own configs only own the display copy
    // (setupNotes) — they never hide a provider.
    return {
      social: await Promise.all(
        this.getSocialProviders()
          .map(async (p) => {
            // The org config (setupNotes) owns the display copy when present.
            const config = orgId
              ? await this._orgProviderConfigManager.getConfig(
                  orgId,
                  p.identifier
                )
              : undefined;
            return {
              name: p.name,
              identifier: p.identifier,
              toolTip: p.toolTip,
              editor: p.editor,
              isExternal: !!p.externalUrl,
              isWeb3: !!p.isWeb3,
              isChromeExtension: !!p.isChromeExtension,
              // True when the deployment env provides a platform app for this
              // provider — the frontend renders it as one-click Connect.
              platformConfigured: isEnvEnabled(p.identifier),
              ...(p.extensionCookies
                ? { extensionCookies: p.extensionCookies }
                : {}),
              ...(p.customFields
                ? { customFields: await p.customFields() }
                : {}),
              ...('setupInstructions' in (config || {}) && (config as any)?.setupInstructions
                ? { setupInstructions: (config as any).setupInstructions }
                : {}),
              ...('setupNotes' in (config || {}) && (config as any)?.setupNotes
                ? { setupInstructions: (config as any).setupNotes }
                : {}),
            };
          })
      ),
      article: [] as any[],
    };
  }

  getAllTools(): {
    [key: string]: {
      description: string;
      dataSchema: any;
      methodName: string;
    }[];
  } {
    return this.getSocialProviders().reduce(
      (all, current) => ({
        ...all,
        [current.identifier]:
          Reflect.getMetadata('custom:tool', current.constructor.prototype) ||
          [],
      }),
      {}
    );
  }

  getAllRulesDescription(): {
    [key: string]: string;
  } {
    return this.getSocialProviders().reduce(
      (all, current) => ({
        ...all,
        [current.identifier]:
          Reflect.getMetadata(
            'custom:rules:description',
            current.constructor
          ) || '',
      }),
      {}
    );
  }

  getAllPlugs() {
    return this.getSocialProviders()
      .map((p) => {
        return {
          name: p.name,
          identifier: p.identifier,
          plugs: (
            Reflect.getMetadata('custom:plug', p.constructor.prototype) || []
          )
            .filter((f: any) => !f.disabled)
            .map((p: any) => ({
              ...p,
              fields: p.fields.map((c: any) => ({
                ...c,
                validation: c?.validation?.toString(),
              })),
            })),
        };
      })
      .filter((f) => f.plugs.length);
  }

  async getInternalPlugs(providerName: string, orgId?: string) {
    const p = this.getSocialIntegrationUnchecked(providerName);
    if (!p) {
      this._logger.warn(`Unknown provider '${providerName}' requested in getInternalPlugs`);
      return { internalPlugs: [] };
    }
    const enabled =
      (orgId
        ? await this._orgProviderConfigManager.isEnabled(orgId, providerName)
        : false) || isEnvEnabled(providerName);
    if (!enabled) {
      throw new NotFoundException(`Integration not available: ${providerName}`);
    }
    return {
      internalPlugs:
        (
          Reflect.getMetadata(
            'custom:internal_plug',
            p.constructor.prototype
          ) || []
        ).filter((f: any) => !f.disabled) || [],
    };
  }

  getAllowedSocialsIntegrations() {
    return this.getSocialProviders().map((p) => p.identifier);
  }

  // Source the per-provider capability row from the kernel's social manifests
  // (manifest.capabilities owns the matrix). Falls back to the static
  // PROVIDER_CAPABILITIES object when the kernel has no usable manifest for the
  // provider (e.g. an unknown/unregistered identifier). Returns null for unknown
  // providers to preserve the existing response shape.
  private _capabilitiesFor(identifier: string): ProviderCapability | null {
    try {
      const manifest = this._kernel
        .listManifests('social')
        .find((m) => m.providerId === identifier);
      const caps = manifest?.capabilities as ProviderCapability | undefined;
      if (caps && Object.keys(caps).length > 0) {
        return caps;
      }
    } catch {
      // Kernel unavailable — fall through to the static matrix.
    }
    return PROVIDER_CAPABILITIES[identifier] || null;
  }

  // Catalog used by the per-tenant "Add channel" picker and config list. All
  // assembly (capabilities, flag normalization, customFields resolution) lives
  // here so controllers only delegate.
  async getSocialProviderCatalog(): Promise<
    Array<{
      identifier: string;
      name: string;
      description: string;
      isExternal: boolean;
      isWeb3: boolean;
      isChromeExtension: boolean;
      platformConfigured: boolean;
      customFields: boolean | any[];
      scopes: string;
      capabilities: ProviderCapability | null;
      setup: ChannelSetupDescriptor | null;
      callbackUrl: string;
    }>
  > {
    const providers = this.getSocialProviders();
    // Default OAuth callback for provider <id>. An org-level `redirectUri`
    // override (adapter `instanceUrl` from the saved channel config) takes
    // precedence at connect time, so this is the DEFAULT shown in the form.
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return Promise.all(
      providers.map(async (p) => ({
        identifier: p.identifier,
        name: p.name,
        description: p.toolTip || '',
        isExternal: !!p.externalUrl,
        isWeb3: !!p.isWeb3,
        isChromeExtension: !!p.isChromeExtension,
        // True when the deployment env provides a platform app for this provider
        // — a per-org BYO app is then an advanced option, not a requirement.
        platformConfigured: isEnvEnabled(p.identifier),
        customFields: p.customFields ? await p.customFields() : false,
        scopes: p.scopes?.join(', ') || '',
        capabilities: this._capabilitiesFor(p.identifier),
        setup: p.setupDescriptor || null,
        callbackUrl: `${frontendUrl}/integrations/social/${p.identifier}`,
      }))
    );
  }
  async getSocialIntegration(
    integration: string,
    orgId?: string,
    version?: string
  ): Promise<SocialProvider> {
    // When the caller pins the connected row's stored version, resolve that exact
    // adapter and reject a retired version (see getSocialIntegrationUnchecked).
    const provider = this.getSocialIntegrationUnchecked(integration, version);
    if (!provider) {
      throw new NotFoundException(`Unknown integration: ${integration}`);
    }
    const enabled =
      (orgId
        ? await this._orgProviderConfigManager.isEnabled(orgId, integration)
        : false) || isEnvEnabled(integration);
    if (!enabled) {
      throw new NotFoundException(`Integration not available: ${integration}`);
    }
    return provider;
  }

  // Returns the provider definition WITHOUT checking the enabled state.
  // Used for listing/maintaining already-connected integrations (channel list,
  // token refresh), which must keep working even if an admin later disables the
  // provider for new connections. Returns undefined for genuinely unknown ids.
  getSocialIntegrationUnchecked(
    integration: string,
    version?: string
  ): SocialProvider | undefined {
    // Resolve through ProviderResolutionService so the org's pinned version is
    // used. The raw singleton is exposed via the bridge's `rawProvider` getter
    // so decorator metadata and custom methods remain accessible.
    try {
      const resolved = version
        ? this._providerResolutionService.resolveProvider<SocialProvider>(
            'social',
            integration,
            { version },
          )
        : this._providerResolutionService.resolveProvider<SocialProvider>(
            'social',
            integration,
            {},
          );

      // 1.3: the Unchecked variant is documented to RETURN undefined for
      // unknown/unavailable ids so a single bad provider can't abort a cross-org
      // sweep. A retired pinned version must therefore return undefined here,
      // NOT throw — the throw belongs to the CHECKED getSocialIntegration, which
      // surfaces the 404/410 for a single user-facing lookup.
      if (version && resolved.module.manifest.status === 'retired') {
        return undefined;
      }

      return (resolved.capability as any).rawProvider as
        | SocialProvider
        | undefined;
    } catch (err) {
      return undefined;
    }
  }

  // INTERNAL USE ONLY - returns decrypted client credentials.
  // Org credentials resolve ONLY through an explicit configId (each named
  // credential set has its own auth) — the by-identifier "primary config"
  // fallback for unbound integrations is gone. Without a configId the order is:
  // platform env app, then undefined.
  async getClientInformation(integration: string, orgId?: string, configId?: string | null) {
    // Resolve the pinned version from the org's bound channel config (the global
    // default when there is no org context or no bound config). This version is
    // returned with the credentials so callers can resolve the exact provider
    // adapter that matches the pinned config.
    const configVersion =
      orgId && configId
        ? (await this._orgProviderConfigManager.getConfigById(orgId, configId))
            ?.version ?? 'v1'
        : 'v1';

    if (orgId) {
      // ensureFresh runs even without a configId: it warms the per-org
      // credential cache that plug methods read via getOrgCredential. It does
      // NOT participate in credential resolution below.
      await this._orgProviderConfigManager.ensureFresh(orgId);
      // A specific named credential set always wins over the platform default
      // (BYO-app override). No configId → no org-credential resolution.
      const orgInfo = configId
        ? await this._orgProviderConfigManager.getClientInfoById(orgId, configId)
        : undefined;
      if (orgInfo?.client_id || orgInfo?.token) {
        return { ...orgInfo, version: configVersion };
      }
      // Platform-owned OAuth app (deployment env) — powers click-connect when the
      // org hasn't brought its own keys.
      const envInfo = getEnvClientInfo(integration);
      if (envInfo) {
        return { ...envInfo, version: configVersion };
      }
      return orgInfo ? { ...orgInfo, version: configVersion } : undefined;
    }
    // No org context: the platform env app is the only live credential source
    // (the deprecated global DB scope is read nowhere).
    const envInfo = getEnvClientInfo(integration);
    return envInfo ? { ...envInfo, version: configVersion } : undefined;
  }

  /**
   * externalUrl providers (dynamic per-instance registration, e.g. Mastodon)
   * carry their instance URL + per-instance app credentials encrypted on
   * Integration.customInstanceDetails. Those stored values are authoritative —
   * org/env client info and any provider default host can belong to a different
   * instance. Analytics/read paths build clientInformation without the
   * integration row; merge the stored details over it here. Tampered/legacy
   * blobs fall back to the passed clientInformation unchanged.
   */
  mergeExternalInstanceDetails<T extends Record<string, any> | undefined>(
    integration: object | null | undefined,
    clientInformation: T
  ): T {
    const stored = (integration as { customInstanceDetails?: string | null } | null | undefined)
      ?.customInstanceDetails;
    if (!stored) return clientInformation;
    try {
      const details = JSON.parse(AuthService.fixedDecryption(stored));
      if (!details || typeof details !== 'object') return clientInformation;
      return { ...(clientInformation || {}), ...details } as T;
    } catch {
      return clientInformation;
    }
  }

  async requireClientInformation(integration: string, orgId?: string, configId?: string | null) {
    const info = await this.getClientInformation(integration, orgId, configId);
    if (!info?.client_id && !info?.token) {
      throw new ProviderNotConfiguredError(integration, orgId);
    }
    return info;
  }

  async isProviderEnabled(integration: string, orgId?: string) {
    if (
      (orgId &&
        (await this._orgProviderConfigManager.isEnabled(orgId, integration))) ||
      isEnvEnabled(integration)
    ) {
      return true;
    }
    return false;
  }

  // ── Cached channel list response (A-19) ──

  /**
   * Build (and cache) the channel list payload rendered by the composer/calendar.
   * The controller only delegates; cache read/write and list assembly live here.
   */
  async getIntegrationListResponse(orgId: string): Promise<{
    integrations: any[];
  }> {
    const cacheKey = `integrations:list:${orgId}`;
    try {
      const cached = await ioRedis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      /* cache miss / redis down — fall through to recompute */
    }

    const rows = await this._integrationRepository.getIntegrationsList(orgId);
    const result = {
      integrations: (
        await Promise.all(
          rows.map(async (p) => {
            // Use the unchecked lookup so already-connected channels keep
            // rendering even if an admin disabled the provider for new
            // connections (the gated getSocialIntegration would throw here and
            // take down the entire channel list for the org).
            const findIntegration = this.getSocialIntegrationUnchecked(
              p.providerIdentifier
            );
            if (!findIntegration) {
              return null;
            }
            return {
              name: p.name,
              id: p.id,
              internalId: p.internalId,
              disabled: p.disabled,
              editor: findIntegration.editor,
              stripLinks: !!findIntegration?.stripLinks?.(),
              picture: p.picture || '/no-picture.jpg',
              identifier: p.providerIdentifier,
              inBetweenSteps: p.inBetweenSteps,
              refreshNeeded: p.refreshNeeded,
              isCustomFields: !!findIntegration.customFields,
              ...(findIntegration.customFields
                ? { customFields: await findIntegration.customFields() }
                : {}),
              display: p.profile,
              type: p.type,
              time: JSON.parse(p.postingTimes),
              changeProfilePicture: !!findIntegration?.changeProfilePicture,
              changeNickName: !!findIntegration?.changeNickname,
              customer: p.customer,
              additionalSettings: p.additionalSettings || '[]',
            };
          })
        )
      ).filter(Boolean),
    };

    try {
      await ioRedis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    } catch {
      /* redis down — serve uncached */
    }

    return result;
  }

  /**
   * Invalidate the cached integrations list after a mutation that changes it.
   */
  async invalidateIntegrationListCache(orgId: string): Promise<void> {
    try {
      await ioRedis.del(`integrations:list:${orgId}`);
    } catch {
      /* redis down — the 60s TTL still bounds staleness */
    }
  }

  // ── OAuth state binding (A-19) ──

  /**
   * Generate the provider OAuth URL and bind all callback-recovery state in Redis.
   * The caller is responsible for validating allowed integrations, campaign
   * ownership, and return-url allowlists; this method only serializes state.
   */
  async generateAuthUrl(
    integration: string,
    orgId: string,
    clientInformation: any,
    options: {
      externalUrl?: string;
      configId?: string;
      refresh?: string;
      onboarding?: boolean;
      campaign?: string;
      redirectUrl?: string;
    } = {}
  ): Promise<{ url: string }> {
    const integrationProvider = await this.getSocialIntegration(
      integration,
      orgId
    );

    if (integrationProvider.externalUrl && !options.externalUrl) {
      throw new Error('Missing external url');
    }

    // Dynamic per-instance client registration (the `externalUrl` hook —
    // Mastodon today, any variable-host channel tomorrow). The user-supplied
    // instance URL is normalized once here so every provider shares the same
    // https/bare-host contract, and the hook is called with the normalized
    // origin. The dynamic client_id/secret + instanceUrl must REACH
    // generateAuthUrl (merged over the static org/env clientInformation,
    // which belongs to a different host) — otherwise the authorize URL is
    // built with an app the target instance has never seen.
    const instanceUrl = integrationProvider.externalUrl
      ? normalizeExternalInstanceUrl(options.externalUrl!)
      : undefined;

    const getExternalUrl = instanceUrl
      ? {
          ...(await integrationProvider.externalUrl!(instanceUrl)),
          instanceUrl,
        }
      : undefined;

    const { codeVerifier, state, url } =
      await integrationProvider.generateAuthUrl(
        getExternalUrl ? { ...clientInformation, ...getExternalUrl } : clientInformation
      );

    // Bind the chosen named credential config to this connection so the callback
    // (and later refresh/publish) use that config's own auth.
    if (options.configId) {
      await ioRedis.set(`config:${state}`, options.configId, 'EX', 3600);
    }

    if (options.refresh) {
      await ioRedis.set(`refresh:${state}`, options.refresh, 'EX', 3600);
    }

    if (options.onboarding) {
      await ioRedis.set(`onboarding:${state}`, 'true', 'EX', 3600);
    }

    if (options.campaign) {
      await ioRedis.set(`campaign:${state}`, options.campaign, 'EX', 3600);
    }

    if (options.redirectUrl) {
      await ioRedis.set(`redirect:${state}`, options.redirectUrl, 'EX', 3600);
    }

    await ioRedis.set(`organization:${state}`, orgId, 'EX', 3600);
    await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
    await ioRedis.set(
      `external:${state}`,
      JSON.stringify(getExternalUrl),
      'EX',
      3600
    );

    return { url };
  }

  // ── Function dispatch whitelist (A-19) ──

  /**
   * Dynamically dispatch a whitelisted provider method. The method name must be
   * either a @Tool-decorated method on the provider or the special `mention`
   * helper. Token refresh is handled automatically.
   */
  async callTool(
    orgId: string,
    integrationId: string,
    name: string,
    data: any
  ): Promise<any> {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      orgId,
      integrationId
    );
    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    const integrationProvider = await this.getSocialIntegration(
      getIntegration.providerIdentifier,
      orgId
    );
    if (!integrationProvider) {
      throw new Error('Invalid provider');
    }

    // POSTS-23/24: allow-list callable provider methods. Tool-decorated methods
    // plus the non-tool `mention` helper are the only legitimate dynamic-dispatch
    // targets for this route.
    const tools = this.getAllTools();
    const allowedMethods = new Set([
      ...(tools[integrationProvider.identifier] || []).map((t) => t.methodName),
      'mention',
    ]);
    if (!allowedMethods.has(name)) {
      throw new BadRequestException(`Unknown provider function: ${name}`);
    }

    // @ts-ignore
    if (!integrationProvider[name]) {
      throw new Error('Function not found');
    }

    try {
      // @ts-ignore
      return await integrationProvider[name](
        getIntegration.token,
        data,
        getIntegration.internalId,
        getIntegration
      );
    } catch (err) {
      if (err instanceof RefreshToken) {
        const refreshed = await this._refreshIntegrationService.refresh(
          getIntegration
        );
        if (!refreshed || !refreshed.accessToken) {
          return false;
        }
        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
        return this.callTool(orgId, integrationId, name, data);
      }
      return false;
    }
  }
}
