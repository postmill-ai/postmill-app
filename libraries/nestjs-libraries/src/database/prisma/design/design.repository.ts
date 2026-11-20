import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import {
  DesignerGallerySort,
  templateCategoryKey,
  templateCategorySearchAliases,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/template-category';

export interface DesignGalleryOptions {
  query?: string;
  sort?: DesignerGallerySort;
  userId?: string;
}

export interface TemplateGalleryOptions extends DesignGalleryOptions {
  folderId?: string | null;
  category?: string;
}

interface QueryWhere {
  sql: string;
  params: any[];
}

const templateCategoryIsBlank = 'TRIM(COALESCE(t."category", \'\')) = \'\'';
const templateModeForCategory = `CASE WHEN ${templateCategoryIsBlank} THEN COALESCE(t.doc->>'mode', 'image') ELSE 'image' END`;

const designWhere = (orgId: string, query?: string): QueryWhere => {
  const params: any[] = [orgId];
  const clauses = ['d."organizationId" = $1', 'd."deletedAt" IS NULL'];
  const search = query?.trim();
  if (search) {
    params.push(search);
    clauses.push(`POSITION(LOWER($${params.length}) IN LOWER(d."name")) > 0`);
  }
  return { sql: clauses.join(' AND '), params };
};

const templateWhere = (
  orgId: string,
  scope: 'org' | undefined,
  options: TemplateGalleryOptions,
  includeCategory = true,
): QueryWhere => {
  const params: any[] = [orgId];
  const clauses = ['t."deletedAt" IS NULL'];
  if (scope === 'org' || options.folderId !== undefined) {
    clauses.push('t."organizationId" = $1');
  } else {
    clauses.push('(t."organizationId" = $1 OR t."isSystem" = true)');
  }

  const search = options.query?.trim();
  if (search) {
    const searchClauses: string[] = [];
    params.push(search);
    searchClauses.push(`POSITION(LOWER($${params.length}) IN LOWER(t."name")) > 0`);
    for (const alias of templateCategorySearchAliases(search)) {
      params.push(alias);
      searchClauses.push(`POSITION(LOWER($${params.length}) IN LOWER(COALESCE(t."category", ''))) > 0`);
    }
    clauses.push(`(${searchClauses.join(' OR ')})`);
  }

  if (options.folderId) {
    params.push(options.folderId);
    clauses.push(`t."folderId" = $${params.length}`);
  } else if (options.folderId === null) {
    clauses.push('t."folderId" IS NULL');
  }

  if (includeCategory && options.category) {
    const key = templateCategoryKey(options.category);
    if (key === 'other') {
      clauses.push(`(LOWER(TRIM(COALESCE(t."category", ''))) = 'other' OR (${templateCategoryIsBlank} AND ${templateModeForCategory} <> 'video'))`);
    } else if (key === 'video') {
      clauses.push(`(LOWER(TRIM(COALESCE(t."category", ''))) = 'video' OR (${templateCategoryIsBlank} AND ${templateModeForCategory} = 'video'))`);
    } else {
      const aliases = key === 'custom'
        ? ['custom', 'custom-video', 'custom video']
        : key === 'ig-post'
          ? ['ig-post', 'instagram-post', 'instagram post', 'ig post']
          : [key];
      params.push(...aliases);
      clauses.push(`LOWER(TRIM(COALESCE(t."category", ''))) IN (${aliases.map((_, index) => `$${params.length - aliases.length + index + 1}`).join(', ')})`);
    }
  }
  return { sql: clauses.join(' AND '), params };
};

const paginationSql = (params: any[], page?: number, limit?: number) => {
  if (page === undefined || limit === undefined) return '';
  params.push(limit, (page - 1) * limit);
  return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
};

@Injectable()
export class DesignRepository {
  constructor(
    private readonly _design: PrismaRepository<'design'>,
    private readonly _designTemplate: PrismaRepository<'designTemplate'>,
    private readonly _designTemplateFolder: PrismaRepository<'designTemplateFolder'>,
    private readonly _designVersion: PrismaRepository<'designVersion'>,
    private readonly _file: PrismaRepository<'file'>,
    private readonly _recentOpen: PrismaRepository<'designerRecentOpen'>
  ) {}

  findById(orgId: string, id: string) {
    return this._design.model.design.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  async findByOrg(
    orgId: string,
    page: number = 1,
    limit: number = 20,
    options: DesignGalleryOptions = {},
  ) {
    const where = designWhere(orgId, options.query);
    const params = [...where.params];
    const recentJoin = options.sort === 'recent' && options.userId;
    if (recentJoin) params.push(options.userId!);
    const join = recentJoin
      ? `LEFT JOIN "DesignerRecentOpen" r ON r."designId" = d."id" AND r."organizationId" = d."organizationId" AND r."userId" = $${params.length}`
      : '';
    const order = options.sort === 'name'
      ? 'LOWER(d."name") ASC, d."name" ASC'
      : options.sort === 'recent'
        ? `${recentJoin ? 'r."openedAt" DESC NULLS LAST,' : ''} d."createdAt" DESC`
        : options.sort === 'newest'
          ? 'd."createdAt" DESC'
          : 'd."updatedAt" DESC';
    const ordered = await (this._design.model as any).$queryRawUnsafe(
      `SELECT d."id" FROM "Design" d ${join}
       WHERE ${where.sql}
       ORDER BY ${order}, d."id" ASC ${paginationSql(params, page, limit)}`,
      ...params,
    ) as Array<{ id: string }>;
    if (!ordered.length) return [];
    const designs = await this._design.model.design.findMany({
      where: { id: { in: ordered.map((row) => row.id) }, organizationId: orgId, deletedAt: null },
      include: { previewFile: { select: { path: true } } },
    });
    const byId = new Map(designs.map((design) => [design.id, design]));
    return ordered.map((row) => byId.get(row.id)!).filter(Boolean);
  }

  async countByOrg(orgId: string, query?: string) {
    const where = designWhere(orgId, query);
    const rows = await (this._design.model as any).$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total FROM "Design" d WHERE ${where.sql}`,
      ...where.params,
    ) as Array<{ total: number }>;
    return rows[0]?.total || 0;
  }

  markDesignOpened(orgId: string, userId: string, designId: string) {
    return this._recentOpen.model.designerRecentOpen.upsert({
      where: { organizationId_userId_designId: { organizationId: orgId, userId, designId } },
      create: { organizationId: orgId, userId, designId, openedAt: new Date() },
      update: { openedAt: new Date() },
    });
  }

  markTemplateOpened(orgId: string, userId: string, templateId: string) {
    return this._recentOpen.model.designerRecentOpen.upsert({
      where: { organizationId_userId_templateId: { organizationId: orgId, userId, templateId } },
      create: { organizationId: orgId, userId, templateId, openedAt: new Date() },
      update: { openedAt: new Date() },
    });
  }

  create(data: {
    organizationId: string;
    name: string;
    doc: any;
    width: number;
    height: number;
    createdById: string;
    previewDataUrl?: string;
    previewFileId?: string;
    campaignId?: string;
  }) {
    return this._design.model.design.create({ data });
  }

  update(id: string, orgId: string, data: { name?: string; doc?: any; width?: number; height?: number; previewDataUrl?: string; previewFileId?: string | null }) {
    return this._design.model.design.update({
      where: { id, organizationId: orgId },
      data,
    });
  }

  softDelete(id: string, orgId: string) {
    return this._design.model.design.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  // Preview-regen maintenance scan: every live design of the org with just the
  // fields the selection rule reads (see DesignService.regenPreviews).
  findDesignsForPreviewRegen(orgId: string, ids?: string[]) {
    return this._design.model.design.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(ids ? { id: { in: ids } } : {}),
      },
      select: { id: true, doc: true, previewFileId: true, previewDataUrl: true },
    });
  }

  // ── DesignVersion operations ────────────────────────────────────────────

  createVersion(data: {
    designId: string;
    organizationId: string;
    name?: string;
    doc: any;
    auto: boolean;
    createdById: string;
    width: number;
    height: number;
    previewDataUrl?: string;
  }) {
    return this._designVersion.model.designVersion.create({ data });
  }

  /**
   * Metadata listing — the `doc` column (a full DesignerDoc, megabytes on a
   * heavy design) is deliberately NOT selected; the panel only needs name,
   * auto flag, thumb and timestamps. The full row loads via findVersion.
   */
  listVersions(orgId: string, designId: string) {
    return this._designVersion.model.designVersion.findMany({
      where: { designId, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        auto: true,
        width: true,
        height: true,
        previewDataUrl: true,
        createdAt: true,
        createdById: true,
      },
    });
  }

  findVersion(orgId: string, designId: string, versionId: string) {
    return this._designVersion.model.designVersion.findFirst({
      where: { id: versionId, designId, organizationId: orgId },
    });
  }

  deleteVersion(orgId: string, designId: string, versionId: string) {
    return this._designVersion.model.designVersion.deleteMany({
      where: { id: versionId, designId, organizationId: orgId },
    });
  }

  /**
   * Count-cap retention, enforced at insert: keep the newest `keep` rows of
   * one class (named/auto) per design, delete the overflow. Two-step because
   * deleteMany can't express "all but the newest N".
   */
  async trimVersions(designId: string, auto: boolean, keep: number) {
    const rows = await this._designVersion.model.designVersion.findMany({
      where: { designId, auto },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      skip: keep,
    });
    if (!rows.length) return 0;
    const r = await this._designVersion.model.designVersion.deleteMany({
      where: { id: { in: rows.map((v) => v.id) } },
    });
    return r.count;
  }

  // No page/limit = the historical full list. Both present = one bounded page;
  // the same filters drive list, count, and category facets.
  async findTemplatesByOrg(
    orgId: string,
    page?: number,
    limit?: number,
    brandProfileId?: string,
    scope?: 'org',
    options: TemplateGalleryOptions = {},
  ) {
    const where = templateWhere(orgId, scope, options);
    const params = [...where.params];
    const recentJoin = options.sort === 'recent' && options.userId;
    if (recentJoin) params.push(options.userId!);
    const join = recentJoin
      ? `LEFT JOIN "DesignerRecentOpen" r ON r."templateId" = t."id" AND r."organizationId" = $1 AND r."userId" = $${params.length}`
      : '';
    let brandOrder = '';
    if (brandProfileId) {
      params.push(brandProfileId);
      brandOrder = `CASE WHEN t."brandProfileId" = $${params.length} THEN 0 ELSE 1 END,`;
    }
    const order = options.sort === 'name'
      ? 'LOWER(t."name") ASC, t."name" ASC'
      : options.sort === 'recent'
        ? `${recentJoin ? 'r."openedAt" DESC NULLS LAST,' : ''} t."createdAt" DESC`
        : options.sort === 'newest'
          ? 't."createdAt" DESC'
          : 't."isSystem" DESC, t."name" ASC';
    const ordered = await (this._designTemplate.model as any).$queryRawUnsafe(
      `SELECT t."id" FROM "DesignTemplate" t ${join}
       WHERE ${where.sql}
       ORDER BY ${brandOrder} ${order}, t."id" ASC ${paginationSql(params, page, limit)}`,
      ...params,
    ) as Array<{ id: string }>;
    if (!ordered.length) return [];
    const templates = await this._designTemplate.model.designTemplate.findMany({
      where: {
        id: { in: ordered.map((row) => row.id) },
        deletedAt: null,
        ...(scope === 'org' ? { organizationId: orgId } : { OR: [{ organizationId: orgId }, { isSystem: true }] }),
      },
      include: { thumbnailFile: { select: { path: true } } },
    });
    const byId = new Map(templates.map((template) => [template.id, template]));
    return ordered.map((row) => byId.get(row.id)!).filter(Boolean);
  }

  async countTemplatesByOrg(orgId: string, scope?: 'org', options: TemplateGalleryOptions = {}) {
    const where = templateWhere(orgId, scope, options);
    const rows = await (this._designTemplate.model as any).$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total FROM "DesignTemplate" t WHERE ${where.sql}`,
      ...where.params,
    ) as Array<{ total: number }>;
    return rows[0]?.total || 0;
  }

  async listTemplateCategories(
    orgId: string,
    scope?: 'org',
    options: TemplateGalleryOptions = {},
  ) {
    const where = templateWhere(orgId, scope, options, false);
    return (this._designTemplate.model as any).$queryRawUnsafe(
      `SELECT DISTINCT t."category", ${templateModeForCategory} AS mode
       FROM "DesignTemplate" t WHERE ${where.sql}`,
      ...where.params,
    ) as Promise<Array<{ category: string | null; mode: string }>>;
  }

  // Preview-regen maintenance scan. Org-owned templates plus system templates:
  // system rows are shared, but the regen only ever ADDS a missing thumbnail
  // (or re-renders a video-mode one) — it never touches name/category/doc, so
  // letting any org's maintenance run repair them is safe and fixes the dark
  // empty tiles every org sees in the Templates tab.
  findTemplatesForPreviewRegen(orgId: string, ids?: string[]) {
    return this._designTemplate.model.designTemplate.findMany({
      where: {
        deletedAt: null,
        ...(ids
          ? { id: { in: ids }, organizationId: orgId }
          : { OR: [{ organizationId: orgId }, { isSystem: true }] }),
      },
      select: { id: true, organizationId: true, doc: true, thumbnailFileId: true },
    });
  }

  // Minimal write for shared (system) templates during preview regen: sets
  // only the thumbnail, bypassing the org-scoped updateTemplate guard.
  setTemplateThumbnail(id: string, thumbnailFileId: string) {
    return this._designTemplate.model.designTemplate.update({
      where: { id },
      data: { thumbnailFileId },
    });
  }

  findTemplateForOrg(id: string, orgId: string) {
    return this._designTemplate.model.designTemplate.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [{ organizationId: orgId }, { isSystem: true }],
      },
    });
  }

  createTemplate(data: {
    organizationId?: string;
    name: string;
    category: string;
    doc: any;
    isSystem?: boolean;
    thumbnailFileId?: string;
    folderId?: string | null;
    brandProfileId?: string | null;
  }) {
    return this._designTemplate.model.designTemplate.create({ data });
  }

  updateTemplate(id: string, orgId: string, data: { name?: string; category?: string; doc?: any; thumbnailFileId?: string; brandProfileId?: string | null }) {
    return this._designTemplate.model.designTemplate.update({
      where: { id, organizationId: orgId },
      data,
    });
  }

  deleteTemplate(id: string, orgId: string) {
    return this._designTemplate.model.designTemplate.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  // ── DesignTemplateFolder operations (mirrors FileFolder in file.repository) ──

  createFolder(orgId: string, data: { name: string; parentId?: string }) {
    return this._designTemplateFolder.model.designTemplateFolder.create({
      data: {
        organizationId: orgId,
        name: data.name,
        parentId: data.parentId || null,
      },
    });
  }

  getFolder(orgId: string, id: string) {
    return this._designTemplateFolder.model.designTemplateFolder.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: {
          select: { templates: true, children: true },
        },
      },
    });
  }

  updateFolder(orgId: string, id: string, data: { name?: string }) {
    return this._designTemplateFolder.model.designTemplateFolder.update({
      where: { id, organizationId: orgId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
      },
    });
  }

  async deleteFolder(orgId: string, id: string) {
    const folder = await this._designTemplateFolder.model.designTemplateFolder.findUnique({
      where: { id, organizationId: orgId },
    });

    if (!folder) {
      return null;
    }

    // The folderId/parentId FKs are ON DELETE SET NULL: deleting the row
    // unfiles its templates and re-parents child folders to root. The
    // emptiness decision lives in the service (see deleteFolder there).
    return this._designTemplateFolder.model.designTemplateFolder.delete({
      where: { id, organizationId: orgId },
    });
  }

  // Counts for the service's not-empty guard. Soft-deleted templates are
  // excluded: a folder holding only trashed templates counts as empty.
  async countFolderActiveContents(orgId: string, id: string) {
    const [templates, children] = await Promise.all([
      this._designTemplate.model.designTemplate.count({
        where: { folderId: id, organizationId: orgId, deletedAt: null },
      }),
      this._designTemplateFolder.model.designTemplateFolder.count({
        where: { parentId: id, organizationId: orgId },
      }),
    ]);
    return { templates, children };
  }

  async getFolderTree(orgId: string) {
    const folders = await this._designTemplateFolder.model.designTemplateFolder.findMany({
      where: { organizationId: orgId },
      include: {
        _count: {
          select: { templates: true, children: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return this._buildFolderTree(folders);
  }

  private _buildFolderTree(folders: any[], parentId: string | null = null): any[] {
    return folders
      .filter((f) => f.parentId === parentId)
      .map((f) => ({
        ...f,
        children: this._buildFolderTree(folders, f.id),
      }));
  }

  // Org-scoped on both sides: a foreign template id can never be relocated,
  // and folder ownership is validated by the service before this is called.
  moveTemplate(orgId: string, templateId: string, folderId: string | null) {
    return this._designTemplate.model.designTemplate.update({
      where: { id: templateId, organizationId: orgId },
      data: { folderId },
    });
  }
}
