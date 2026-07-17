import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { Response } from 'express';
import { CampaignsRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.repository';
import { CampaignItemRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.repository';
import { CampaignItemResolverRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.resolver';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { ENTITY_ENUM_TO_SLUG } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-entity.types';
import { campaignReportHtml } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-report.html';
import { computeGoalProgress } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-goal-progress';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import type { CampaignEntityType, State } from '@prisma/client';

// Pre-computed campaign analytics, composed by the controller (from AnalyticsService)
// and threaded into the report — CampaignReportService never injects AnalyticsService
// (controller composition; see plan §1.5 / §3.4).
export interface CampaignReportAnalytics {
  series: Record<string, { date: string; value: number; previousValue?: number }[]>;
  byChannel: any[];
  window: { from: string; to: string };
}

function sanitizeCsvCell(value: unknown): string {
  let cell = String(value ?? '');
  // Neutralize CSV formula-injection payloads by prefixing a single quote when
  // a cell starts with one of the characters spreadsheet apps interpret as formulas.
  if (/^[+=\-@\t\r\n]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replace(/"/g, '""')}"`;
}

export interface CampaignReport {
  campaign: any;
  engagement: {
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    avgViews: number;
    avgLikes: number;
    avgComments: number;
    clickTotal: number;
  };
  posts: any[];
  channelBreakdown: Record<string, { views: number; likes: number; comments: number; posts: number }>;
  itemInventory: Record<string, any[]>;
  goals: Array<{ metric: string; target: number; current: number; pct: number }>;
  analytics?: CampaignReportAnalytics;
}

@Injectable()
export class CampaignReportService {
  constructor(
    private _campaignsRepository: CampaignsRepository,
    private _campaignItems: CampaignItemRepository,
    private _campaignItemResolver: CampaignItemResolverRepository,
    private _postsService: PostsService,
    private _socialCommentsService: SocialCommentsService,
    private _analyticsService: AnalyticsService,
  ) {}

  // Resolve a share token to the campaign's identity so the controller can
  // compute analytics before rendering the public report. Returns null when the
  // token is unknown or sharing is disabled (controller → 404).
  async resolveShareToken(
    token: string
  ): Promise<{ id: string; organizationId: string } | null> {
    const campaign = await this._campaignsRepository.findByShareToken(token);
    if (!campaign || !campaign.shareEnabled) return null;
    return { id: campaign.id, organizationId: campaign.organizationId };
  }

  async buildReport(
    id: string,
    organizationId: string,
    analytics?: CampaignReportAnalytics
  ): Promise<CampaignReport> {
    const campaign = await this._campaignsRepository.findById(id, organizationId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const [engagement, posts, stateCounts, clickTotal, itemCounts, syncedCommentCount] = await Promise.all([
      this._campaignsRepository.getEngagement(id, organizationId),
      this._postsService.getCampaignPosts(organizationId, id),
      this._campaignsRepository.getPostStateCounts(id, organizationId),
      this._campaignsRepository.getCampaignClickTotal(id, organizationId),
      this._campaignItems.countByCampaignGroupedByType(id, organizationId),
      this._socialCommentsService.countCampaignComments(organizationId, id),
    ]);

    // Match the dashboard: totalComments reflects synced, replyable comments.
    engagement.totalComments = syncedCommentCount;

    const channelBreakdown: CampaignReport['channelBreakdown'] = {};
    for (const post of posts) {
      const name = post.integration?.name || 'Unknown';
      if (!channelBreakdown[name]) {
        channelBreakdown[name] = { views: 0, likes: 0, comments: 0, posts: 0 };
      }
      channelBreakdown[name].views += post.lastViews || 0;
      channelBreakdown[name].likes += post.lastLikes || 0;
      channelBreakdown[name].comments += post.lastComments || 0;
      channelBreakdown[name].posts += 1;
    }

    const allItems = await this._campaignItems.listByCampaign(id, organizationId);
    const itemInventory: Record<string, any[]> = {};
    for (const row of itemCounts) {
      const slug = ENTITY_ENUM_TO_SLUG[row.entityType];
      const ids = allItems.filter((i) => i.entityType === row.entityType).map((i) => i.entityId);
      const resolved = await this._campaignItemResolver.resolveBatch(organizationId, row.entityType, ids);
      itemInventory[slug] = Array.from(resolved.values()).map((r) => ({ ...r, entityType: slug }));
    }

    const goals = computeGoalProgress(campaign.goals, engagement, stateCounts, clickTotal);

    // Share tokens are internal-only; never let them leak through report exports.
    const { shareToken: _shareToken, shareEnabled: _shareEnabled, ...campaignForReport } = campaign;

    return {
      campaign: campaignForReport,
      engagement: { ...engagement, clickTotal },
      posts,
      channelBreakdown,
      itemInventory,
      goals,
      ...(analytics ? { analytics } : {}),
    };
  }

  async toJson(id: string, organizationId: string, analytics?: CampaignReportAnalytics) {
    return this.buildReport(id, organizationId, analytics);
  }

  async toPublicJson(token: string, analytics?: CampaignReportAnalytics) {
    const campaign = await this._campaignsRepository.findByShareToken(token);
    if (!campaign || !campaign.shareEnabled) {
      throw new Error('Campaign not found');
    }
    const full = await this.buildReport(campaign.id, campaign.organizationId);

    // Strip internal/sensitive fields from the public-facing report.
    const sanitizeItem = (item: any) => ({
      name: item.name,
      entityType: item.entityType,
      subtitle: item.subtitle,
    });

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        color: campaign.color,
        description: campaign.description,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
      },
      engagement: full.engagement,
      goals: full.goals,
      posts: full.posts.map((p) => ({
        title: p.title,
        content: p.content,
        state: p.state,
        publishDate: p.publishDate,
        lastViews: p.lastViews,
        lastLikes: p.lastLikes,
        lastComments: p.lastComments,
        integration: { name: p.integration?.name },
      })),
      channelBreakdown: full.channelBreakdown,
      itemInventory: Object.fromEntries(
        Object.entries(full.itemInventory).map(([type, items]) => [
          type,
          items.map(sanitizeItem),
        ])
      ),
      // Explicit analytics whitelist (3.4 / R2.3): only the trend series, the
      // per-channel display name + provider identifier + KPIs, and the window —
      // never an integrationId, a picture, or any internal campaign field.
      // Mirrors AnalyticsShareService.buildPublicReport's byChannel whitelist.
      ...(analytics
        ? {
            analytics: {
              series: analytics.series,
              byChannel: analytics.byChannel.map((c: any) => ({
                name: c.name,
                identifier: c.identifier,
                kpis: c.kpis,
              })),
              window: analytics.window,
            },
          }
        : {}),
    };
  }

  async toCsv(id: string, organizationId: string): Promise<string> {
    const report = await this.buildReport(id, organizationId);
    const rows = report.posts.map((p) => ({
      id: p.id,
      title: p.title || p.content?.slice(0, 100) || '',
      channel: p.integration?.name || '',
      state: p.state,
      publishDate: p.publishDate?.toISOString?.() || p.publishDate,
      views: p.lastViews || 0,
      likes: p.lastLikes || 0,
      comments: p.lastComments || 0,
    }));

    const headers = ['id', 'title', 'channel', 'state', 'publishDate', 'views', 'likes', 'comments'];
    const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => sanitizeCsvCell((r as any)[h])).join(','))];
    return lines.join('\n');
  }

  async toPdf(id: string, organizationId: string): Promise<Buffer> {
    const report = await this.buildReport(id, organizationId);
    const html = campaignReportHtml(report);

    const puppeteer = (await import('puppeteer')).default;

    // Only disable Chromium's sandbox in CI/container environments where a real
    // user namespace is unavailable. Production defaults to sandboxed mode.
    const disableSandbox =
      process.env.CI === 'true' || process.env.PUPPETEER_DISABLE_SANDBOX === 'true';
    const args = [
      ...(disableSandbox
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : []),
      '--disable-dev-shm-usage',
    ];

    const browser = await puppeteer.launch({
      headless: true,
      args,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
      await browser.close();
    }
  }

  /**
   * Compose campaign analytics (post-snapshot trend + per-channel breakdown) for
   * a report. Non-fatal: a failure yields `undefined` so the caller can build a
   * report without the analytics block rather than failing the whole request.
   */
  async computeAnalytics(
    organizationId: string,
    campaignId: string
  ): Promise<CampaignReportAnalytics | undefined> {
    try {
      const to = dayjs().format('YYYY-MM-DD');
      const from = dayjs().subtract(90, 'day').format('YYYY-MM-DD');
      const campaign = await this._campaignsRepository.findById(
        campaignId,
        organizationId
      );
      if (!campaign) {
        return undefined;
      }
      const overview = await this._analyticsService.getOverview(
        { id: organizationId } as any,
        from,
        to,
        [],
        false,
        { campaignIds: [campaignId] }
      );
      return {
        series: overview.series,
        byChannel: overview.byChannel,
        window: { from, to },
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Build and dispatch a campaign report in the requested format.
   * `res` is required for csv/pdf downloads; json returns the body directly.
   */
  async dispatchReport(
    id: string,
    organizationId: string,
    format: 'json' | 'csv' | 'pdf',
    res?: Response
  ): Promise<any> {
    if (format === 'csv') {
      const csv = await this.toCsv(id, organizationId);
      if (res) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="campaign-${id}.csv"`
        );
      }
      return csv;
    }

    if (format === 'pdf') {
      const pdf = await this.toPdf(id, organizationId);
      if (res) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="campaign-${id}.pdf"`
        );
      }
      return pdf;
    }

    const analytics = await this.computeAnalytics(organizationId, id);
    return this.toJson(id, organizationId, analytics);
  }
}
