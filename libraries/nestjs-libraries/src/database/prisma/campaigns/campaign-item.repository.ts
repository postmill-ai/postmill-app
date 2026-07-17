import { Injectable } from '@nestjs/common';
import { CampaignEntityType } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// Polymorphic campaign↔entity tags for the 8 non-post types. The POST type is
// special-cased onto Post.campaignId (this repo also owns that write, since a
// repository may touch multiple models — cf. StorageRepository).
@Injectable()
export class CampaignItemRepository {
  constructor(
    private _item: PrismaRepository<'campaignItem'>,
    private _post: PrismaRepository<'post'>
  ) {}

  tag(data: {
    campaignId: string;
    organizationId: string;
    entityType: CampaignEntityType;
    entityId: string;
    createdById?: string;
  }) {
    return this._item.model.campaignItem.upsert({
      where: {
        campaignId_entityType_entityId: {
          campaignId: data.campaignId,
          entityType: data.entityType,
          entityId: data.entityId,
        },
      },
      create: data,
      update: {}, // idempotent — re-tagging is a no-op
    });
  }

  untag(
    campaignId: string,
    organizationId: string,
    entityType: CampaignEntityType,
    entityId: string
  ) {
    return this._item.model.campaignItem.deleteMany({
      where: { campaignId, organizationId, entityType, entityId },
    });
  }

  listByCampaign(campaignId: string, organizationId: string) {
    return this._item.model.campaignItem.findMany({
      where: { campaignId, organizationId },
      orderBy: [{ entityType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // Reverse lookup: which campaigns is this (non-post) entity tagged on.
  async listCampaignIdsForItem(
    organizationId: string,
    entityType: CampaignEntityType,
    entityId: string
  ): Promise<string[]> {
    const rows = await this._item.model.campaignItem.findMany({
      where: { organizationId, entityType, entityId },
      select: { campaignId: true },
    });
    return rows.map((r) => r.campaignId);
  }

  countByCampaignGroupedByType(campaignId: string, organizationId: string) {
    return this._item.model.campaignItem.groupBy({
      by: ['entityType'],
      where: { campaignId, organizationId },
      _count: { _all: true },
    });
  }

  async copyAllToCampaign(
    fromCampaignId: string,
    toCampaignId: string,
    organizationId: string,
    createdById?: string
  ) {
    const rows = await this._item.model.campaignItem.findMany({
      where: { campaignId: fromCampaignId, organizationId },
    });
    if (rows.length === 0) return 0;
    const result = await this._item.model.campaignItem.createMany({
      data: rows.map((r) => ({
        campaignId: toCampaignId,
        organizationId,
        entityType: r.entityType,
        entityId: r.entityId,
        createdById,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  // Daily purge: drop tags whose campaign ended more than `days` ago. Ongoing
  // campaigns (endDate null) are never purged.
  deleteExpired(days: number, now: Date) {
    const cutoff = new Date(now.getTime() - days * 86400000);
    return this._item.model.campaignItem.deleteMany({
      where: { campaign: { endDate: { not: null, lt: cutoff } } },
    });
  }

  // ── POST special-case (Post.campaignId) ──
  async setPostCampaign(
    organizationId: string,
    postId: string,
    campaignId: string | null
  ) {
    return this._post.model.post.updateMany({
      where: { id: postId, organizationId },
      data: { campaignId },
    });
  }

  async getPostCampaignId(
    organizationId: string,
    postId: string
  ): Promise<string | null> {
    const post = await this._post.model.post.findFirst({
      where: { id: postId, organizationId },
      select: { campaignId: true },
    });
    return post?.campaignId ?? null;
  }
}
