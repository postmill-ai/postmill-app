import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignEntityType } from '@prisma/client';
import { CampaignItemRepository } from './campaign-item.repository';
import { CampaignItemResolverRepository } from './campaign-item.resolver';
import { CampaignsRepository } from './campaigns.repository';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import {
  ENTITY_ENUM_TO_SLUG,
  ResolvedCampaignItem,
  slugToEnum,
} from './campaign-entity.types';

@Injectable()
export class CampaignTagService {
  constructor(
    private _items: CampaignItemRepository,
    private _resolver: CampaignItemResolverRepository,
    private _campaigns: CampaignsRepository,
    private _audit: AuditService
  ) {}

  private _toEnum(slug: string): CampaignEntityType {
    const en = slugToEnum(slug);
    if (!en) throw new BadRequestException(`Unknown entity type: ${slug}`);
    return en;
  }

  private async _requireCampaign(orgId: string, campaignId: string) {
    const campaign = await this._campaigns.findById(campaignId, orgId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async tagItem(
    orgId: string,
    campaignId: string,
    userId: string | undefined,
    entityTypeSlug: string,
    entityId: string
  ) {
    const campaign = await this._requireCampaign(orgId, campaignId);
    const entityType = this._toEnum(entityTypeSlug);

    let name: string;
    if (entityType === 'POST') {
      await this._items.setPostCampaign(orgId, entityId, campaignId);
      name = await this._resolveOneName(orgId, entityType, entityId);
    } else {
      // Ownership gate: the resolver only returns rows scoped to this org+type,
      // and skips orphans. A foreign/other-org entityId resolves to nothing —
      // reject instead of tagging it (else it renders later as an orphan / a
      // contained cross-tenant leak).
      const resolved = await this._resolver.resolveBatch(orgId, entityType, [entityId]);
      const item = resolved.get(entityId);
      if (!item) throw new NotFoundException('Item not found');
      await this._items.tag({ campaignId, organizationId: orgId, entityType, entityId, createdById: userId });
      name = item.name || entityId;
    }

    await this._audit.create({
      organizationId: orgId,
      userId,
      action: 'campaign.item.add',
      entity: 'campaign',
      entityId: campaignId,
      entityName: campaign.name,
      details: JSON.stringify({ entityType: entityTypeSlug, entityId, itemName: name }),
    });
    return { success: true };
  }

  async untagItem(
    orgId: string,
    campaignId: string,
    userId: string | undefined,
    entityTypeSlug: string,
    entityId: string
  ) {
    const campaign = await this._requireCampaign(orgId, campaignId);
    const entityType = this._toEnum(entityTypeSlug);

    if (entityType === 'POST') {
      // Only clear if the post is actually on this campaign.
      const current = await this._items.getPostCampaignId(orgId, entityId);
      if (current === campaignId) await this._items.setPostCampaign(orgId, entityId, null);
    } else {
      await this._items.untag(campaignId, orgId, entityType, entityId);
    }

    const name = await this._resolveOneName(orgId, entityType, entityId);
    await this._audit.create({
      organizationId: orgId,
      userId,
      action: 'campaign.item.remove',
      entity: 'campaign',
      entityId: campaignId,
      entityName: campaign.name,
      details: JSON.stringify({ entityType: entityTypeSlug, entityId, itemName: name }),
    });
    return { success: true };
  }

  // Grouped + resolved items for one campaign (the 8 non-post types). Posts are
  // surfaced separately by the dashboard via Post.campaignId.
  async listItems(orgId: string, campaignId: string): Promise<Record<string, ResolvedCampaignItem[]>> {
    await this._requireCampaign(orgId, campaignId);
    const rows = await this._items.listByCampaign(campaignId, orgId);

    const byType = new Map<CampaignEntityType, { entityId: string; taggedAt: Date }[]>();
    for (const r of rows) {
      const list = byType.get(r.entityType) || [];
      list.push({ entityId: r.entityId, taggedAt: r.createdAt });
      byType.set(r.entityType, list);
    }

    const out: Record<string, ResolvedCampaignItem[]> = {};
    for (const [entityType, list] of byType) {
      const resolved = await this._resolver.resolveBatch(orgId, entityType, list.map((l) => l.entityId));
      const slug = ENTITY_ENUM_TO_SLUG[entityType];
      out[slug] = list
        .map((l) => {
          const r = resolved.get(l.entityId);
          if (!r) return null; // orphan (deleted source) — skipped
          return { ...r, entityType: slug, taggedAt: l.taggedAt };
        })
        .filter(Boolean) as ResolvedCampaignItem[];
    }
    return out;
  }

  // Reverse: which campaigns is this entity tagged on (for the per-entity selector).
  async listCampaignsForItem(orgId: string, entityTypeSlug: string, entityId: string) {
    const entityType = this._toEnum(entityTypeSlug);
    let campaignIds: string[];
    if (entityType === 'POST') {
      const cid = await this._items.getPostCampaignId(orgId, entityId);
      campaignIds = cid ? [cid] : [];
    } else {
      campaignIds = await this._items.listCampaignIdsForItem(orgId, entityType, entityId);
    }
    if (campaignIds.length === 0) return [];
    return this._campaigns.findByIds(orgId, campaignIds);
  }

  private async _resolveOneName(orgId: string, entityType: CampaignEntityType, entityId: string) {
    if (entityType === 'POST') return 'a post';
    const m = await this._resolver.resolveBatch(orgId, entityType, [entityId]);
    return m.get(entityId)?.name || entityId;
  }

  async purgeExpiredItems(days: number): Promise<{ deleted: number }> {
    const result = await this._items.deleteExpired(days, new Date());
    return { deleted: result.count };
  }

  async copyTags(
    orgId: string,
    fromCampaignId: string,
    toCampaignId: string,
    userId?: string
  ): Promise<number> {
    // Verify the destination campaign belongs to this org before copying any
    // tags into it (defense-in-depth against a leaked/foreign target id).
    await this._requireCampaign(orgId, toCampaignId);
    return this._items.copyAllToCampaign(fromCampaignId, toCampaignId, orgId, userId);
  }
}
