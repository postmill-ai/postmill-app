import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { CampaignEntityType, State } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class CampaignsRepository {
  constructor(
    private _prisma: PrismaService,
  ) {}

  findByOrg(organizationId: string, take?: number, skip?: number) {
    return this._prisma.campaign.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        _count: { select: { posts: true } },
        // Distinct channels the campaign publishes to — lets the analytics
        // campaign filter scope by channel without an extra request per campaign.
        posts: { select: { integrationId: true }, distinct: ['integrationId'] },
      },
    });
  }

  findById(id: string, organizationId: string) {
    return this._prisma.campaign.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { _count: { select: { posts: true } } },
    });
  }

  findByShareToken(token: string) {
    return this._prisma.campaign.findFirst({
      where: { shareToken: token, shareEnabled: true, deletedAt: null },
    });
  }

  // Lightweight fetch for the per-entity campaign selector (id/name/color/dates).
  findByIds(organizationId: string, ids: string[]) {
    return this._prisma.campaign.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        color: true,
        startDate: true,
        endDate: true,
        archived: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: {
    organizationId: string;
    name: string;
    color?: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    createdById?: string;
    goals?: any;
    utmEnabled?: boolean;
    client?: string;
    project?: string;
    tags?: any;
  }) {
    return this._prisma.campaign.create({ data });
  }

  update(
    id: string,
    organizationId: string,
    data: {
      name?: string;
      color?: string;
      description?: string;
      startDate?: Date;
      endDate?: Date;
      archived?: boolean;
      goals?: any;
      shareToken?: string;
      shareEnabled?: boolean;
      utmEnabled?: boolean;
      client?: string;
      project?: string;
      tags?: any;
    },
  ) {
    return this._prisma.campaign.update({ where: { id, organizationId }, data });
  }

  countCreatedBy(organizationId: string, userId: string) {
    return this._prisma.campaign.count({
      where: { organizationId, createdById: userId, deletedAt: null },
    });
  }

  softDelete(id: string, organizationId: string) {
    return this._prisma.campaign.update({
      where: { id, organizationId },
      data: { deletedAt: new Date() },
    });
  }

  async getEngagement(id: string, organizationId: string) {
    const result = await this._prisma.post.aggregate({
      where: { campaignId: id, organizationId, deletedAt: null },
      _sum: { lastViews: true, lastLikes: true, lastComments: true },
      _avg: { lastViews: true, lastLikes: true, lastComments: true },
    });

    const topPost = await this._prisma.post.findFirst({
      where: { campaignId: id, organizationId, deletedAt: null },
      orderBy: [
        { lastLikes: { sort: 'desc', nulls: 'last' } },
        { lastComments: { sort: 'desc', nulls: 'last' } },
      ],
      select: {
        id: true,
        content: true,
        title: true,
        lastViews: true,
        lastLikes: true,
        lastComments: true,
        integration: { select: { name: true } },
      },
    });

    return {
      totalViews: result._sum.lastViews || 0,
      totalLikes: result._sum.lastLikes || 0,
      totalComments: result._sum.lastComments || 0,
      avgViews: result._avg.lastViews || 0,
      avgLikes: result._avg.lastLikes || 0,
      avgComments: result._avg.lastComments || 0,
      topPost: topPost
        ? {
            id: topPost.id,
            title: topPost.title || topPost.content?.slice(0, 100) || '',
            lastViews: topPost.lastViews,
            lastLikes: topPost.lastLikes,
            lastComments: topPost.lastComments,
            integration: topPost.integration?.name || '',
          }
        : null,
    };
  }

  async getPostStateCounts(id: string, organizationId: string) {
    const rows = await this._prisma.post.groupBy({
      by: ['state'],
      where: { campaignId: id, organizationId, deletedAt: null, parentPostId: null },
      _count: { _all: true },
    });
    return rows.reduce((acc, r) => {
      acc[r.state] = r._count._all;
      return acc;
    }, {} as Record<string, number>);
  }

  async getUpcomingQueuePosts(id: string, organizationId: string, limit = 5) {
    return this._prisma.post.findMany({
      where: {
        campaignId: id,
        organizationId,
        state: State.QUEUE,
        publishDate: { gte: dayjs.utc().toDate() },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: { publishDate: 'asc' },
      take: limit,
      select: {
        id: true,
        title: true,
        content: true,
        publishDate: true,
        integration: { select: { id: true, name: true, providerIdentifier: true, picture: true } },
      },
    });
  }

  async getCappedItemsByCampaign(
    id: string,
    organizationId: string,
    entityType: CampaignEntityType,
    limit = 10
  ) {
    return this._prisma.campaignItem.findMany({
      where: { campaignId: id, organizationId, entityType },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { entityId: true, createdAt: true },
    });
  }

  async getCampaignClickTotal(id: string, organizationId: string): Promise<number> {
    // ShortLink stores postId without a Prisma relation, so resolve ids in two
    // indexed steps rather than loading all org short links into memory.
    const campaignPosts = await this._prisma.post.findMany({
      where: {
        campaignId: id,
        organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (campaignPosts.length === 0) return 0;

    const campaignPostIds = campaignPosts.map((p) => p.id);
    const links = await this._prisma.shortLink.findMany({
      where: {
        organizationId,
        postId: { in: campaignPostIds },
      },
      select: { id: true },
    });
    if (links.length === 0) return 0;

    const result = await this._prisma.shortLinkSnapshot.aggregate({
      where: {
        organizationId,
        shortLinkId: { in: links.map((l) => l.id) },
      },
      _sum: { clicks: true },
    });
    return result._sum.clicks || 0;
  }

  findActiveCampaigns(organizationId: string, limit: number) {
    const now = dayjs.utc().toDate();
    return this._prisma.campaign.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        endDate: true,
        goals: true,
      },
    });
  }

  getSummaryPosts(organizationId: string, campaignIds: string[]) {
    return this._prisma.post.findMany({
      where: {
        organizationId,
        campaignId: { in: campaignIds },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        campaignId: true,
        state: true,
        lastViews: true,
        lastLikes: true,
        lastComments: true,
      },
    });
  }

  async getClickTotalsForPosts(organizationId: string, postIds: string[]) {
    if (postIds.length === 0) return new Map<string, number>();

    const links = await this._prisma.shortLink.findMany({
      where: {
        organizationId,
        postId: { in: postIds },
      },
      select: { id: true, postId: true },
    });
    if (links.length === 0) return new Map<string, number>();

    const linkIds = links.map((l) => l.id);
    const snapshots = await this._prisma.shortLinkSnapshot.groupBy({
      by: ['shortLinkId'],
      where: {
        organizationId,
        shortLinkId: { in: linkIds },
      },
      _sum: { clicks: true },
    });

    const clicksByLink = new Map<string, number>();
    for (const s of snapshots) {
      clicksByLink.set(s.shortLinkId, s._sum.clicks || 0);
    }

    const postIdByLink = new Map(links.map((l) => [l.id, l.postId!]));
    const result = new Map<string, number>();
    for (const [linkId, clicks] of clicksByLink) {
      const postId = postIdByLink.get(linkId);
      if (!postId) continue;
      result.set(postId, (result.get(postId) || 0) + clicks);
    }
    return result;
  }
}
