import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WatchlistRepository } from '@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.repository';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import dayjs from 'dayjs';

@Injectable()
export class WatchlistService {
  private _logger = new Logger(WatchlistService.name);

  constructor(
    private _watchlistRepository: WatchlistRepository,
  ) {}

  list(organizationId: string) {
    return this._watchlistRepository.findByOrg(organizationId);
  }

  add(params: {
    organizationId: string;
    provider: string;
    handle: string;
    displayName?: string;
  }) {
    return this._watchlistRepository.create(params);
  }

  update(id: string, organizationId: string, data: { displayName?: string; enabled?: boolean }) {
    return this._watchlistRepository.update(id, organizationId, data);
  }

  remove(id: string, organizationId: string) {
    return this._watchlistRepository.softDelete(id, organizationId);
  }

  getEnabledAccounts(organizationId: string) {
    return this._watchlistRepository.findEnabledByOrg(organizationId);
  }

  /**
   * Competitor-overlay series (6.3): the watched account's metric time-series
   * (followers by default). Org-scoped — a cross-org / missing id 404s. Returns
   * an empty `series` when nothing has been probed yet.
   */
  async getSeries(
    id: string,
    organizationId: string,
    metric = 'followers',
  ) {
    const account = await this._watchlistRepository.findByIdForOrg(id, organizationId);
    if (!account) {
      throw new NotFoundException('Watched account not found');
    }

    const rows = await this._watchlistRepository.getMetricSeries(id, metric);

    return {
      id: account.id,
      provider: account.provider,
      handle: account.handle,
      displayName: account.displayName,
      metric,
      series: rows.map((r) => ({
        date: dayjs(r.capturedAt).format('YYYY-MM-DD'),
        value: r.value,
      })),
    };
  }

  /**
   * Probes a watched account and records its current metric value.
   * Gracefully handles probe failures (403/unsupported) by recording the
   * error and disabling the capability — never crashes the sweep.
   */
  async probeAndRecord(params: {
    watchedAccountId: string;
    organizationId: string;
    provider: string;
    handle: string;
    metric: string;
  }) {
    try {
      const value = await this.probePublicMetric(params.provider, params.handle);
      await this._watchlistRepository.recordMetric({
        watchedAccountId: params.watchedAccountId,
        metric: params.metric,
        value,
      });
      await this._watchlistRepository.setLastError(params.watchedAccountId, params.organizationId, null);
    } catch (err) {
      const message = (err as Error).message || 'Probe failed';
      await this.markProbeFailed(params.watchedAccountId, params.organizationId, message);
      this._logger.warn(`Failed to probe watched account ${params.watchedAccountId}: ${message}`);
    }
  }

  private async probePublicMetric(provider: string, rawHandle: string) {
    const handle = rawHandle.replace(/^@/, '').trim();
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(handle)) {
      throw new Error('Invalid watched account handle');
    }

    const url = this.publicProfileUrl(provider, handle);
    const response = await safeFetch(url, {
      headers: {
        'User-Agent': 'Postmill watchlist probe',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`Public profile probe returned ${response.status}`);
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new Error('Failed to read response body');
    }
    const metric = this.extractPublicCount(body);
    if (metric === null) {
      throw new Error('No public metric found');
    }

    return metric;
  }

  private publicProfileUrl(provider: string, handle: string) {
    switch (provider) {
      case 'x':
        return `https://x.com/${encodeURIComponent(handle)}`;
      case 'instagram':
      case 'instagram-standalone':
        return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
      case 'tiktok':
        return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
      case 'youtube':
        return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
      default:
        throw new Error(`Watchlist probes are not supported for ${provider}`);
    }
  }

  private extractPublicCount(body: string) {
    const normalized = body.replace(/&quot;/g, '"');
    const patterns = [
      /"followers_count"\s*:\s*(\d+)/i,
      /"followerCount"\s*:\s*(\d+)/i,
      /"subscriberCount"\s*:\s*"?(\d+)"?/i,
      /([\d,.]+)\s+(?:Followers|followers|subscribers|Subscribers)/,
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (!match) continue;
      const value = Number(match[1].replace(/[,.]/g, ''));
      if (Number.isFinite(value)) return value;
    }

    return null;
  }

  async markProbeFailed(watchedAccountId: string, organizationId: string, error: string) {
    try {
      await this._watchlistRepository.disableWithError(watchedAccountId, organizationId, error);
    } catch (err) {
      this._logger.warn(
        `Failed to mark probe error for watched account ${watchedAccountId}: ${(err as Error).message}`,
      );
    }
  }
}
