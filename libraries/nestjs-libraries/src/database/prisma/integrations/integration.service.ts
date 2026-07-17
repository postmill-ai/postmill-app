import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { randomUUID } from 'crypto';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { uniq, uniqBy } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

dayjs.extend(utc);

@Injectable()
export class IntegrationService {
  private readonly _logger = new Logger(IntegrationService.name);

  constructor(
    private _integrationRepository: IntegrationRepository,
    @Inject(forwardRef(() => AutopostService))
    private _autopostsService: AutopostService,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _storageService: StorageService,
    private _auditService: AuditService
  ) {}

  // Best-effort audit (B4): a logging failure must never break the channel action.
  private async _audited(entry: {
    organizationId: string;
    action: string;
    entity: string;
    entityId?: string;
    entityName?: string;
    details?: string;
  }) {
    try {
      await this._auditService.create(entry);
    } catch (err) {
      this._logger.warn(
        `Failed to audit ${entry.action}: ${(err as any)?.message}`
      );
    }
  }

  async changeActiveCron(orgId: string) {
    // POSTS-16: IntegrationService must not reach into AutopostRepository.
    // stopAll(orgId) cancels events for all active autoposts and disables them.
    await this._autopostsService.stopAll(orgId);
    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  /**
   * Aggregate cached mentions with a live provider query. The live lookup is
   * dispatched through the whitelisted `IntegrationManager.callTool` method
   * (special `mention` function). Moved from IntegrationsController so the
   * aggregation logic is reusable and testable outside the HTTP layer.
   */
  async getMentionsForQuery(
    orgId: string,
    integrationId: string,
    query: string
  ): Promise<{ id: string; image?: string; label: string }[] | { none: true }> {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      orgId,
      integrationId
    );
    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    let newList: any[] | { none: true } = [];
    try {
      newList =
        (await this._integrationManager.callTool(orgId, integrationId, 'mention', {
          query,
        })) || [];
    } catch (err) {
      this._logger.warn((err as Error)?.message ?? String(err));
    }

    if (!Array.isArray(newList) && newList?.none) {
      return newList as { none: true };
    }

    const list = await this.getMentions(
      getIntegration.providerIdentifier,
      query
    );

    if (Array.isArray(newList) && newList.length) {
      await this.insertMentions(
        getIntegration.providerIdentifier,
        newList
          .map((p: any) => ({
            name: p.label || '',
            username: p.id || '',
            image: p.image || '',
            doNotCache: p.doNotCache || false,
          }))
          .filter((f: any) => f.name && !f.doNotCache)
      );
    }

    return uniqBy(
      [
        ...list.map((p) => ({
          id: p.username,
          image: p.image,
          label: p.name,
        })),
        ...(newList as any[]),
      ],
      (p) => p.id
    ).filter((f) => f.label && f.id);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  async updateProviderSettings(
    org: string,
    id: string,
    additionalSettings: string
  ) {
    const result = await this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
    await this._audited({
      organizationId: org,
      action: 'integration.settings.update',
      entity: 'integration',
      entityId: id,
    });
    return result;
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string,
    providerConfigId?: string,
    providerVersion = 'v1'
  ) {
    const uploadedPicture = picture
      ? await (await this._storageService.getLocalAdapterForOrg(org, true)).uploadSimple(picture)
      : undefined;

    // Detect a brand-new social channel connect (vs a re-auth / token refresh of
    // an existing row) so we only kick off the 90-day analytics backfill once.
    const existing =
      type === 'social'
        ? await this._integrationRepository.existsByInternalId(org, internalId)
        : null;

    const result = await this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails,
      providerConfigId,
      providerVersion
    );

    // Audit genuine channel connects (B4). Token-refresh / cookie-reauth callers
    // (refreshTokens, RefreshIntegrationService, the custom re-auth route) do not
    // pass a `username`, so this gate records only user-initiated OAuth connects
    // and skips periodic refreshes.
    if (username) {
      await this._audited({
        organizationId: org,
        action: 'integration.connect',
        entity: 'integration',
        entityId: result?.id,
        entityName: name,
        details: JSON.stringify({ provider, internalId }),
      });
    }

    // On a brand-new social channel connect, enqueue a 90-day analytics backfill
    // (Track A / STATS_UPGRADE 0.4). Non-fatal: a send failure must never break
    // integration creation. The consumer no-ops for no-analytics providers.
    if (type === 'social' && !existing && result?.id) {
      try {
        if (isInngestEnabled()) {
          await inngest.send({
            name: 'analytics/backfill',
            data: { integrationId: result.id, organizationId: org },
          });
        }
      } catch (err) {
        this._logger.warn(
          `Failed to enqueue analytics/backfill for integration ${result?.id}: ${
            (err as any)?.message
          }`
        );
      }
    }

    return result;
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  getIntegrationsList(org: string) {
    return this._integrationRepository.getIntegrationsList(org);
  }

  async getHealthSummary(org: string) {
    const list = await this._integrationRepository.getIntegrationsHealth(org);
    return list.filter((i) => i.refreshNeeded || i.disabled);
  }

  updateNameAndUrl(org: string, id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(org, id, name, url);
  }

  getIntegrationById(org: string, id: string) {
    return this._integrationRepository.getIntegrationById(org, id);
  }

  getIntegrationsByIds(org: string, ids: string[]) {
    return this._integrationRepository.getIntegrationsByIds(org, ids);
  }

  async refreshToken(provider: SocialProvider, refresh: string, orgId?: string) {
    try {
      const clientInformation = orgId
        ? await this._integrationManager.requireClientInformation(
            provider.identifier,
            orgId
          ).catch(() => undefined)
        : undefined;
      const { refreshToken, accessToken, expiresIn } =
        await provider.refreshToken(refresh, clientInformation);

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration) {
    await this._integrationRepository.disconnectChannel(orgId, integration.id);
    await this.informAboutRefreshError(orgId, integration);
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = ''
  ) {
    await this._notificationService.notify({
      orgId,
      category: 'channels',
      title: `Could not refresh your ${integration.providerIdentifier} channel ${err}`,
      message: `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/posts`,
      metadata: { integrationId: integration.id, providerIdentifier: integration.providerIdentifier },
      channels: { email: true, push: true, inApp: true },
    });
  }

  async refreshNeeded(org: string, id: string) {
    return this._integrationRepository.refreshNeeded(org, id);
  }

  async setBetweenRefreshSteps(id: string, orgId: string) {
    return this._integrationRepository.setBetweenRefreshSteps(orgId, id);
  }

  async refreshTokens() {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    for (const integration of integrations) {
      // Unchecked lookup: existing tokens must keep refreshing regardless of
      // whether the provider is currently enabled for new connections, and a
      // single disabled/unknown provider must not abort the whole batch.
      const provider = this._integrationManager.getSocialIntegrationUnchecked(
        integration.providerIdentifier,
        integration.providerVersion
      );
      if (!provider) {
        continue;
      }

      const data = await this.refreshToken(provider, integration.refreshToken!, integration.organizationId);

      if (!data) {
        await this.informAboutRefreshError(
          integration.organizationId,
          integration
        );
        await this._integrationRepository.refreshNeeded(
          integration.organizationId,
          integration.id
        );
        return;
      }

      const { refreshToken, accessToken, expiresIn } = data;

      await this.createOrUpdateIntegration(
        undefined,
        !!provider.oneTimeToken,
        integration.organizationId,
        integration.name,
        undefined,
        'social',
        integration.internalId,
        integration.providerIdentifier,
        accessToken,
        refreshToken,
        expiresIn
      );
    }
  }

  async disableChannel(org: string, id: string) {
    const result = await this._integrationRepository.disableChannel(org, id);
    await this._audited({
      organizationId: org,
      action: 'integration.disable',
      entity: 'integration',
      entityId: id,
    });
    return result;
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      !!process.env.STRIPE_PUBLISHABLE_KEY &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    const result = await this._integrationRepository.enableChannel(org, id);
    await this._audited({
      organizationId: org,
      action: 'integration.enable',
      entity: 'integration',
      entityId: id,
    });
    return result;
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    const result = await this._integrationRepository.deleteChannel(org, id);
    await this._audited({
      organizationId: org,
      action: 'integration.delete',
      entity: 'integration',
      entityId: id,
    });

    // F3: kill any still-sleeping token-refresh loop for this channel.
    // Non-fatal: a send failure must never break the delete.
    try {
      if (isInngestEnabled()) {
        await inngest.send({
          name: 'integration/refresh-token/cancel',
          data: { integrationId: id },
          id: `refresh_cancel_${id}_${randomUUID()}`,
        });
      }
    } catch (err) {
      this._logger.warn(
        `Failed to emit integration/refresh-token/cancel for integration ${id}: ${
          (err as any)?.message
        }`
      );
    }

    return result;
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );
    if (!getIntegration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    if (!getIntegration.inBetweenSteps) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    const provider = await this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier,
      org
    );

    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    const getIntegrationInformation = await provider.fetchPageInformation(
      getIntegration.token,
      data
    );

    await this.checkForDeletedOnceAndUpdate(
      org,
      String(getIntegrationInformation.id)
    );

    let picture = getIntegrationInformation.picture;
    const localBase = `${process.env.FRONTEND_URL || ''}/uploads`;
    if (picture && picture.indexOf(localBase) === -1) {
      const adapter = await this._storageService.getLocalAdapterForOrg(org, true);
      picture = await adapter.uploadSimple(picture);
    }

    await this._integrationRepository.updateIntegration(id, {
      picture,
      internalId: String(getIntegrationInformation.id),
      organizationId: org,
      name: getIntegrationInformation.name,
      inBetweenSteps: false,
      token: getIntegrationInformation.access_token,
      profile: getIntegrationInformation.username,
    });

    return { success: true };
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    forceRefresh = false
  ): Promise<AnalyticsData[]> {
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegrationUnchecked(
        getIntegration.providerIdentifier,
        getIntegration.providerVersion
      );

    // 1.3: the Unchecked lookup returns undefined for a retired-pinned version
    // (it no longer throws). A retired adapter can't serve analytics — return
    // empty instead of TypeError-ing on `integrationProvider.refreshWait` below.
    if (!integrationProvider) {
      return [];
    }

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        // Negative cache: without it, every analytics view re-attempts the
        // live token refresh (and re-disconnects) for this integration.
        await ioRedis.set(
          `integration:${org.id}:${integration}:${date}`,
          JSON.stringify([]),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 60
            : 600
        );
        return [];
      }
    }

    const getIntegrationData = await ioRedis.get(
      `integration:${org.id}:${integration}:${date}`
    );
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    if (integrationProvider.analytics) {
      try {
        const clientInformation = await this._integrationManager.requireClientInformation(
          integration,
          getIntegration.organizationId,
          getIntegration.providerConfigId
        ).catch(() => undefined);

        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          +date,
          clientInformation
        );
        await ioRedis.set(
          `integration:${org.id}:${integration}:${date}`,
          JSON.stringify(loadAnalytics),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 1
            : 3600
        );
        return loadAnalytics;
      } catch (e) {
        if (e instanceof RefreshToken) {
          return this.checkAnalytics(org, integration, date, true);
        }
        this._logger.warn(
          `checkAnalytics failed for integration ${integration}: ${
            (e as any)?.message
          }`
        );
        // Negative cache: the analytics live fallback calls this per dashboard
        // view, so without it a persistently failing integration re-fires the
        // full provider fan-out (incl. token refresh) on every view.
        await ioRedis.set(
          `integration:${org.id}:${integration}:${date}`,
          JSON.stringify([]),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 60
            : 600
        );
      }
    }

    return [];
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = (
      await this._integrationManager.getInternalPlugs(
        getIntegration.providerIdentifier
      )
    ).internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration =
      await this._integrationManager.getSocialIntegration(
        getIntegration.providerIdentifier,
        data.orgId
      );

    // Warm the org credential cache before invoking the internal plug — see processPlugs.
    // Internal plug methods (e.g. X repostPostUsers) sign with app credentials read via
    // getOrgCredential, which is empty until the org's cache is populated (v3.7.1: no env fallback).
    await this._integrationManager.getClientInformation(
      getIntegration.providerIdentifier,
      data.orgId
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlugForSystem(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = await this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier,
      getPlugById.integration.organizationId
    );

    // Warm the org credential cache before invoking the plug. Plug methods that sign with the
    // provider's app credentials (e.g. X OAuth1 auto-repost/auto-plug) read them via
    // getOrgCredential, which resolves from the lazily-populated per-org cache. Plugs run in
    // worker processes that may not have touched this org yet, and as of v3.7.1 there is no
    // process.env fallback — without this warm the credentials resolve empty.
    await this._integrationManager.getClientInformation(
      getPlugById.integration.providerIdentifier,
      getPlugById.integration.organizationId
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }


  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
