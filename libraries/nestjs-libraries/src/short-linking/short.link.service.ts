import { Injectable, Logger } from '@nestjs/common';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { OrgShortLinkSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.repository';
import { type ShortLinkContext } from '@gitroom/nestjs-libraries/short-linking/short-link.interface';
import { uniq } from 'lodash';
import striptags from 'striptags';

@Injectable()
export class ShortLinkService {
  private readonly _logger = new Logger(ShortLinkService.name);

  constructor(
    private _settingsService: OrgShortLinkSettingsService,
    private _repository: OrgShortLinkSettingsRepository,
    private _resolution: ProviderResolutionService,
  ) {}

  private async _resolve(
    orgId: string
  ): Promise<{ adapter: any; ctx: ShortLinkContext; version: string } | null> {
    const active = await this._settingsService.getActiveProvider(orgId);
    if (!active) return null;

    const version = active.version ?? 'v1';
    try {
      const adapter = this._resolution.resolveShortLink(active.identifier, {
        version,
        credentials: active.credentials || {},
        orgId,
      });
      if (!adapter) return null;

      return {
        adapter,
        ctx: {
          orgId,
          credentials: active.credentials || {},
          customDomain: active.customDomain || undefined,
        },
        version,
      };
    } catch {
      return null;
    }
  }

  // Member-facing provider list for the composer's short-link picker. Returns
  // only providers the org has configured + enabled, plus which one is active.
  async listSelectableProviders(orgId: string): Promise<{
    providers: {
      identifier: string;
      name: string;
      customDomain: string;
      version: string;
    }[];
    activeIdentifier: string | null;
  }> {
    const all = await this._settingsService.getProviders(orgId);
    const selectable = (all || []).filter(
      (p: any) => p.enabled && p.isConfigured
    );
    return {
      providers: selectable.map((p: any) => ({
        identifier: p.identifier,
        name: p.name,
        customDomain: p.customDomain || '',
        version: p.version ?? 'v1',
      })),
      activeIdentifier:
        selectable.find((p: any) => p.isActive)?.identifier ?? null,
    };
  }

  // Sets the org's active short-link provider (used by the composer picker).
  // Delegates to the settings service, which throws if the provider is not
  // configured or is missing required credentials.
  async setActiveProvider(orgId: string, identifier: string) {
    return this._settingsService.setActive(orgId, identifier);
  }

  async shouldShortlink(
    orgId: string,
    messages: string[]
  ): Promise<{ ask: boolean; providerName?: string; domain?: string }> {
    const resolved = await this._resolve(orgId);
    if (!resolved) return { ask: false };

    const domain = resolved.adapter.resolveDomain(resolved.ctx);
    if (!domain || domain === 'empty') return { ask: false };

    const mergeMessages = messages.join(' ');
    const urlRegex = /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*))/gm;
    const urls = mergeMessages.match(urlRegex);
    const ask = urls ? urls.some((url) => url.indexOf(domain) === -1) : false;

    return {
      ask,
      providerName: resolved.adapter.name || resolved.adapter.identifier,
      domain,
    };
  }

  async askShortLinkedin(orgId: string, messages: string[]): Promise<boolean> {
    return (await this.shouldShortlink(orgId, messages)).ask;
  }

  async convertTextToShortLinks(orgId: string, messagesList: string[]) {
    const resolved = await this._resolve(orgId);
    if (!resolved) return messagesList;
    const { adapter, ctx } = resolved;
    const domain = adapter.resolveDomain(ctx);

    const messages = messagesList.map((text) => {
      return text
        .replace(/&quest;/g, '?')
        .replace(/&num;/g, '#')
        .replace(/&amp;/g, '&');
    });

    const urlRegex = /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*))/gm;
    return Promise.all(
      messages.map(async (text) => {
        const urls = uniq(text.match(urlRegex));
        if (!urls) return text;

        const replacementMap: Record<string, string> = {};
        await Promise.all(
          urls.map(async (url) => {
            if (url.indexOf(domain) === -1) {
              try {
                const result = await adapter.createShortLink(ctx, url);
                replacementMap[url] = result.shortUrl;
                await this._repository.recordLink({
                  organizationId: orgId,
                  provider: adapter.identifier,
                  shortUrl: result.shortUrl,
                  originalUrl: url,
                  providerLinkId: result.providerLinkId,
                  providerVersion: resolved.version,
                  postId: undefined,
                }).catch((err) => {
                  this._logger.warn(`Failed to record short link in ledger: ${(err as Error).message}`);
                });
              } catch (err) {
                this._logger.warn(`Failed to shorten URL ${url}: ${(err as Error).message}`);
                replacementMap[url] = url;
              }
            } else {
              replacementMap[url] = url;
            }
          })
        );

        return text.replace(urlRegex, (url) => replacementMap[url] ?? url);
      })
    );
  }

  async convertShortLinksToLinks(orgId: string, messages: string[]) {
    const resolved = await this._resolve(orgId);
    if (!resolved) return messages;
    const { adapter, ctx } = resolved;
    const domain = adapter.resolveDomain(ctx);

    if (!adapter.expandShortLink) return messages;

    const urlRegex = /https?:\/\/[^\s/$.?#].[^\s]*/g;
    return Promise.all(
      messages.map(async (text) => {
        const urls = text.match(urlRegex);
        if (!urls) return text;

        const replacementMap: Record<string, string> = {};
        await Promise.all(
          urls.map(async (url) => {
            if (url.indexOf(domain) > -1) {
              try {
                replacementMap[url] = await adapter.expandShortLink!(ctx, url);
              } catch {
                replacementMap[url] = url;
              }
            } else {
              replacementMap[url] = url;
            }
          })
        );

        return text.replace(urlRegex, (url) => replacementMap[url] ?? url);
      })
    );
  }

  async getStatistics(orgId: string, messages: string[]) {
    const resolved = await this._resolve(orgId);
    if (!resolved) return [];
    const { adapter, ctx } = resolved;
    const domain = adapter.resolveDomain(ctx);

    if (!adapter.linkStatistics) return [];

    const mergeMessages = messages.join(' ');
    const regex = new RegExp(`https?://${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s]*`, 'g');
    const urls = striptags(mergeMessages).match(regex);
    if (!urls) return [];

    try {
      return await adapter.linkStatistics(ctx, urls);
    } catch (err) {
      this._logger.warn(`Failed to get link statistics: ${(err as Error).message}`);
      return [];
    }
  }

  async getAllLinks(orgId: string) {
    const resolved = await this._resolve(orgId);
    if (!resolved) return [];
    const { adapter, ctx } = resolved;

    if (!adapter.listLinks) return [];

    try {
      const allLinks: any[] = [];
      let page = 1;
      const maxPages = 10;
      while (page <= maxPages) {
        const pageResults = await adapter.listLinks(ctx, page);
        if (!pageResults.length) break;
        allLinks.push(...pageResults);
        if (pageResults.length < 50) break;
        page++;
      }
      return allLinks;
    } catch (err) {
      this._logger.warn(`Failed to list links: ${(err as Error).message}`);
      return [];
    }
  }
}
