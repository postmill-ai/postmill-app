import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CampaignsRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.repository';
import { CampaignItemRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.repository';
import { CampaignTagService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.service';
import { CampaignItemResolverRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.resolver';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { ENTITY_ENUM_TO_SLUG } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-entity.types';
import { computeGoalProgress } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-goal-progress';
import { randomBytes } from 'crypto';
import { z } from 'zod';

export const CampaignGoalSchema = z.object({
  metric: z.string().min(1),
  target: z.number().finite().gte(0),
});

export const CampaignGoalsSchema = z.array(CampaignGoalSchema);

export type CampaignGoal = z.infer<typeof CampaignGoalSchema>;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private _campaignsRepository: CampaignsRepository,
    private _campaignItems: CampaignItemRepository,
    private _campaignTagService: CampaignTagService,
    private _campaignItemResolver: CampaignItemResolverRepository,
    private _audit: AuditService,
    private _postsService: PostsService,
    private _usersService: UsersService,
    private _socialCommentsService: SocialCommentsService,
    private _fileService: FileService,
  ) {}

  // Full file records for a campaign's tagged files (newest-tagged first,
  // orphans/deleted dropped), for the /files-style Files tab. Capped defensively.
  async getCampaignFiles(id: string, organizationId: string) {
    const campaign = await this._campaignsRepository.findById(id, organizationId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const items = await this._campaignsRepository.getCappedItemsByCampaign(
      id,
      organizationId,
      'FILE',
      500,
    );
    const ids = items.map((i) => i.entityId);
    if (!ids.length) return [];

    const files = await this._fileService.getByIds(organizationId, ids);
    const byId = new Map(files.map((f) => [f.id, f]));
    // Preserve the tagged order (newest first) and drop any deleted rows.
    return ids.map((fid) => byId.get(fid)).filter(Boolean);
  }

  private mapCampaign(row: any) {
    const { posts, shareToken, shareEnabled, ...campaign } = row;
    return {
      ...campaign,
      integrationIds: [
        ...new Set(
          (posts as { integrationId: string }[]).map((p) => p.integrationId)
        ),
      ],
    };
  }

  async list(organizationId: string) {
    const rows = await this._campaignsRepository.findByOrg(organizationId);
    // Expose each campaign's distinct channel ids (from its posts) as
    // `integrationIds`; strip the raw posts join and sharing fields from the
    // response.
    return rows.map((row) => this.mapCampaign(row));
  }

  async listPaged(organizationId: string, take: number, skip: number) {
    const rows = await this._campaignsRepository.findByOrg(
      organizationId,
      take,
      skip
    );
    return rows.map((row) => this.mapCampaign(row));
  }

  async get(id: string, organizationId: string) {
    const campaign = await this._campaignsRepository.findById(id, organizationId);
    if (!campaign) return null;
    const { shareToken, shareEnabled, ...safeCampaign } = campaign;
    return safeCampaign;
  }

  private _validateGoals(goals: unknown): CampaignGoal[] | undefined {
    if (goals === undefined || goals === null) return undefined;
    const parsed = CampaignGoalsSchema.safeParse(goals);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid campaign goals: ${parsed.error.errors.map((e) => e.message).join(', ')}`
      );
    }
    return parsed.data;
  }

  private _validateDateOrder(startDate?: Date, endDate?: Date) {
    if (
      startDate &&
      endDate &&
      new Date(endDate).getTime() <= new Date(startDate).getTime()
    ) {
      throw new BadRequestException('endDate must be after startDate');
    }
  }

  async create(params: {
    organizationId: string;
    name: string;
    color?: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    utmEnabled?: boolean;
    client?: string;
    project?: string;
    tags?: string[];
    goals?: CampaignGoal[] | unknown;
    createdById?: string;
  }) {
    const goals = this._validateGoals(params.goals);
    this._validateDateOrder(params.startDate, params.endDate);
    return this._campaignsRepository.create({ ...params, goals });
  }

  async update(id: string, organizationId: string, data: {
    name?: string;
    color?: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    archived?: boolean;
    utmEnabled?: boolean;
    client?: string;
    project?: string;
    tags?: string[];
    goals?: CampaignGoal[] | unknown;
  }) {
    const goals = this._validateGoals(data.goals);
    this._validateDateOrder(data.startDate, data.endDate);
    return this._campaignsRepository.update(id, organizationId, { ...data, goals });
  }

  remove(id: string, organizationId: string) {
    return this._campaignsRepository.softDelete(id, organizationId);
  }

  countCreatedBy(organizationId: string, userId: string) {
    return this._campaignsRepository.countCreatedBy(organizationId, userId);
  }

  getEngagement(id: string, organizationId: string) {
    return this._campaignsRepository.getEngagement(id, organizationId);
  }

  async getSummaries(organizationId: string, limit = 6) {
    const campaigns = await this._campaignsRepository.findActiveCampaigns(
      organizationId,
      limit
    );
    if (campaigns.length === 0) return [];

    const campaignIds = campaigns.map((c) => c.id);
    const [posts] = await Promise.all([
      this._campaignsRepository.getSummaryPosts(organizationId, campaignIds),
    ]);

    const postIds = posts.map((p) => p.id);
    const clickTotals = await this._campaignsRepository.getClickTotalsForPosts(
      organizationId,
      postIds
    );

    const postsByCampaign = new Map<string, typeof posts>();
    for (const p of posts) {
      const list = postsByCampaign.get(p.campaignId!) || [];
      list.push(p);
      postsByCampaign.set(p.campaignId!, list);
    }

    return campaigns.map((campaign) => {
      const campaignPosts = postsByCampaign.get(campaign.id) || [];
      const stateCounts: Record<string, number> = {};
      const engagement = { totalViews: 0, totalLikes: 0, totalComments: 0 };
      let clickTotal = 0;

      for (const p of campaignPosts) {
        stateCounts[p.state] = (stateCounts[p.state] || 0) + 1;
        engagement.totalViews += p.lastViews || 0;
        engagement.totalLikes += p.lastLikes || 0;
        engagement.totalComments += p.lastComments || 0;
        clickTotal += clickTotals.get(p.id) || 0;
      }

      return {
        id: campaign.id,
        name: campaign.name,
        endDate: campaign.endDate,
        postCounts: {
          queue: stateCounts['QUEUE'] || 0,
          published: stateCounts['PUBLISHED'] || 0,
          draft: stateCounts['DRAFT'] || 0,
          error: stateCounts['ERROR'] || 0,
        },
        goals: computeGoalProgress(campaign.goals, engagement, stateCounts, clickTotal),
      };
    });
  }

  async getDashboard(id: string, organizationId: string) {
    const campaign = await this._campaignsRepository.findById(id, organizationId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const [
      engagement,
      stateCounts,
      upcoming,
      posts,
      itemCounts,
      recentChangelog,
      clickTotal,
      syncedCommentCount,
    ] = await Promise.all([
      this._campaignsRepository.getEngagement(id, organizationId),
      this._campaignsRepository.getPostStateCounts(id, organizationId),
      this._campaignsRepository.getUpcomingQueuePosts(id, organizationId),
      this._postsService.getCampaignPosts(organizationId, id),
      this._campaignItems.countByCampaignGroupedByType(id, organizationId),
      this._audit.findByEntity(organizationId, 'campaign', id, { limit: 20 }),
      this._campaignsRepository.getCampaignClickTotal(id, organizationId),
      this._socialCommentsService.countCampaignComments(organizationId, id),
    ]);

    // The "Comments" KPI/goal reflects synced, replyable SocialComment rows — not the
    // platform-reported lastComments sum — so it agrees with the dashboard's comments section.
    engagement.totalComments = syncedCommentCount;

    const itemPanels: Record<string, any[]> = {};
    await Promise.all(
      itemCounts.map(async (row) => {
        const slug = ENTITY_ENUM_TO_SLUG[row.entityType];
        const capped = await this._campaignsRepository.getCappedItemsByCampaign(
          id,
          organizationId,
          row.entityType,
          10
        );
        const resolved = await this._campaignItemResolver.resolveBatch(
          organizationId,
          row.entityType,
          capped.map((c) => c.entityId)
        );
        itemPanels[slug] = capped
          .map((c) => {
            const r = resolved.get(c.entityId);
            if (!r) return null;
            return { ...r, entityType: slug, taggedAt: c.createdAt };
          })
          .filter(Boolean) as any[];
      })
    );

    // Resolve changelog user names in one batch.
    const userIds = [...new Set(recentChangelog.map((l: any) => l.userId).filter(Boolean))];
    const names = userIds.length ? await this._usersService.getNamesByIds(userIds as string[]) : new Map<string, string>();
    const changelog = recentChangelog.map((l: any) => ({
      ...l,
      user: l.userId ? { name: names.get(l.userId) || l.userId } : null,
    }));

    const goals = computeGoalProgress(campaign.goals, engagement, stateCounts, clickTotal);

    // Channels the campaign actually uses = union of (a) channels its posts publish
    // to and (b) explicitly-tagged INTEGRATION items. Deduped by integration id; the
    // dedicated Channels section renders this (the tagged-items panel no longer shows
    // channels). postCount comes from the already-loaded posts (no extra query).
    const channelMap = new Map<
      string,
      { id: string; name: string; picture: string | null; providerIdentifier: string; postCount: number }
    >();
    for (const p of posts as any[]) {
      const integ = p.integration;
      if (!integ?.id) continue;
      const existing = channelMap.get(integ.id);
      if (existing) {
        existing.postCount += 1;
      } else {
        channelMap.set(integ.id, {
          id: integ.id,
          name: integ.name,
          picture: integ.picture || null,
          providerIdentifier: integ.providerIdentifier,
          postCount: 1,
        });
      }
    }
    for (const tagged of itemPanels['channel'] || []) {
      if (!channelMap.has(tagged.id)) {
        channelMap.set(tagged.id, {
          id: tagged.id,
          name: tagged.name,
          picture: null,
          providerIdentifier: tagged.icon || tagged.subtitle || '',
          postCount: 0,
        });
      }
    }
    const channels = [...channelMap.values()].sort((a, b) => b.postCount - a.postCount);

    // Resolve the creator into a display object the header can link to.
    let createdBy:
      | { id: string; name: string; email: string; avatarUrl: string | null }
      | null = null;
    if (campaign.createdById) {
      const profiles = await this._usersService.getPublicProfilesByIds([campaign.createdById]);
      createdBy = profiles.get(campaign.createdById) || null;
    }

    // NOTE: shareToken/shareEnabled are intentionally KEPT here — this is the authenticated,
    // org-scoped dashboard (the owner needs the token to display/copy the public link and to
    // know sharing is on across reloads). The PUBLIC report strips internals separately via
    // CampaignReportService.toPublicJson. Stripping them here broke share-state rehydration.
    return {
      campaign: { ...campaign, createdBy },
      engagement,
      stateCounts,
      upcoming,
      posts,
      itemPanels,
      channels,
      recentChangelog: changelog,
      clickTotal,
      goals,
    };
  }

  async copy(
    id: string,
    organizationId: string,
    userId: string | undefined,
    options: { name?: string; shiftDates?: boolean; resetSchedule?: boolean }
  ) {
    const source = await this._campaignsRepository.findById(id, organizationId);
    if (!source) throw new NotFoundException('Campaign not found');

    const name = options.name || `${source.name} (Copy)`;
    const shiftMonths = options.shiftDates ? 1 : 0;
    const shiftDate = (d?: Date | null) =>
      d ? new Date(d.getFullYear(), d.getMonth() + shiftMonths, d.getDate()) : d;

    const copy = await this._campaignsRepository.create({
      organizationId,
      name,
      color: source.color,
      description: source.description,
      startDate: shiftDate(source.startDate),
      endDate: shiftDate(source.endDate),
      goals: source.goals,
      createdById: userId,
      utmEnabled: source.utmEnabled,
      client: source.client,
      project: source.project,
      tags: source.tags,
    });

    await this._campaignTagService.copyTags(organizationId, id, copy.id, userId);

    const sourceDrafts = await this._postsService.getCampaignDrafts(organizationId, id);
    for (const group of Object.values(sourceDrafts)) {
      for (const draft of group) {
        const dto = this._postsService.buildCreateDtoFromPost(draft);
        dto.campaignId = copy.id;
        dto.date =
          options.resetSchedule || !draft.publishDate
            ? new Date().toISOString()
            : new Date(
                new Date(draft.publishDate).getFullYear(),
                new Date(draft.publishDate).getMonth() +
                  (options.shiftDates ? 1 : 0),
                new Date(draft.publishDate).getDate()
              ).toISOString();
        try {
          const created = await this._postsService.createPost(organizationId, dto, 'WEB');
          for (const c of created) {
            await this._postsService.setDraftPending(organizationId, c.postId);
          }
        } catch (err) {
          this.logger.warn(
            `Failed to copy draft ${draft.id} (${draft.title || 'untitled'}) from campaign ${id}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }

    await this._audit.create({
      organizationId,
      userId,
      action: 'campaign.copy',
      entity: 'campaign',
      entityId: copy.id,
      entityName: copy.name,
      details: JSON.stringify({ sourceId: id, sourceName: source.name }),
    });

    return copy;
  }

  async mintShareToken(id: string, organizationId: string) {
    const campaign = await this._campaignsRepository.findById(id, organizationId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const token = randomBytes(32).toString('hex');
    return this._campaignsRepository.update(id, organizationId, {
      shareToken: token,
      shareEnabled: true,
    });
  }

  async disableShare(id: string, organizationId: string) {
    return this._campaignsRepository.update(id, organizationId, { shareEnabled: false });
  }

  async findByShareToken(token: string) {
    return this._campaignsRepository.findByShareToken(token);
  }
}
