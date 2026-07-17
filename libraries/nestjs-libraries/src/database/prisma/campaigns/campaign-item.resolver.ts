import { Injectable } from '@nestjs/common';
import { CampaignEntityType } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ResolvedItem } from './campaign-entity.types';

// Resolves a batch of entity ids (of one type) to their display fields. A
// repository (touches Prisma directly across several models) — one findMany per
// type, so no N+1. Missing ids (deleted source rows) are simply absent from the map.
@Injectable()
export class CampaignItemResolverRepository {
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _vpn: PrismaRepository<'orgVpnConfig'>,
    private _ai: PrismaRepository<'aIOrgProviderConfig'>,
    private _brand: PrismaRepository<'aIBrandProfile'>,
    private _storage: PrismaRepository<'storageProviderConfig'>,
    private _file: PrismaRepository<'file'>,
    private _sets: PrismaRepository<'sets'>,
    private _signatures: PrismaRepository<'signatures'>
  ) {}

  async resolveBatch(
    organizationId: string,
    entityType: CampaignEntityType,
    ids: string[]
  ): Promise<Map<string, ResolvedItem>> {
    const map = new Map<string, ResolvedItem>();
    if (ids.length === 0) return map;
    const where = { id: { in: ids }, organizationId };

    switch (entityType) {
      case 'INTEGRATION': {
        const rows = await this._integration.model.integration.findMany({
          where,
          select: { id: true, name: true, picture: true, providerIdentifier: true },
        });
        rows.forEach((r) =>
          map.set(r.id, { id: r.id, name: r.name, icon: r.providerIdentifier, subtitle: r.providerIdentifier })
        );
        break;
      }
      case 'ORG_VPN_CONFIG': {
        const rows = await this._vpn.model.orgVpnConfig.findMany({
          where,
          select: { id: true, name: true, identifier: true },
        });
        rows.forEach((r) =>
          map.set(r.id, { id: r.id, name: r.name || r.identifier, icon: r.identifier, subtitle: r.identifier })
        );
        break;
      }
      case 'AI_ORG_PROVIDER_CONFIG': {
        const rows = await this._ai.model.aIOrgProviderConfig.findMany({
          where,
          select: { id: true, identifier: true },
        });
        rows.forEach((r) => map.set(r.id, { id: r.id, name: r.identifier, icon: r.identifier }));
        break;
      }
      case 'AI_BRAND_PROFILE': {
        const rows = await this._brand.model.aIBrandProfile.findMany({
          where,
          // Non-sensitive display fields only — never the brand voice/instructions,
          // so the read-only info modal shown to members without `brands:read`
          // doesn't leak the AI prompt content.
          select: { id: true, name: true, language: true, enabled: true, isDefault: true },
        });
        rows.forEach((r) => {
          const parts = [
            r.isDefault ? 'Default brand' : null,
            r.language || null,
            r.enabled === false ? 'Disabled' : null,
          ].filter(Boolean) as string[];
          map.set(r.id, {
            id: r.id,
            name: r.name || 'Untitled brand',
            subtitle: parts.join(' · ') || undefined,
          });
        });
        break;
      }
      case 'STORAGE_PROVIDER_CONFIG': {
        const rows = await this._storage.model.storageProviderConfig.findMany({
          where,
          select: { id: true, name: true },
        });
        rows.forEach((r) => map.set(r.id, { id: r.id, name: r.name }));
        break;
      }
      case 'FILE': {
        const rows = await this._file.model.file.findMany({
          where,
          select: { id: true, name: true, thumbnail: true, path: true, type: true },
        });
        rows.forEach((r) =>
          map.set(r.id, { id: r.id, name: r.name, icon: r.thumbnail || r.path, subtitle: r.type })
        );
        break;
      }
      case 'SETS': {
        const rows = await this._sets.model.sets.findMany({
          where,
          select: { id: true, name: true },
        });
        rows.forEach((r) => map.set(r.id, { id: r.id, name: r.name }));
        break;
      }
      case 'SIGNATURES': {
        const rows = await this._signatures.model.signatures.findMany({
          where,
          select: { id: true, name: true, content: true },
        });
        rows.forEach((r) => {
          // Signature content is plain text (textarea-edited). Surface a bounded
          // preview so the tagged-items panel + read-only info modal can show it.
          const preview = (r.content || '').trim().slice(0, 280);
          map.set(r.id, {
            id: r.id,
            name: r.name || preview.slice(0, 40) || 'Untitled signature',
            subtitle: preview || undefined,
          });
        });
        break;
      }
      default:
        break;
    }
    return map;
  }
}
