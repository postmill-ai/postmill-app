import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class DesignRepository {
  constructor(
    private readonly _design: PrismaRepository<'design'>,
    private readonly _designTemplate: PrismaRepository<'designTemplate'>,
    private readonly _designTemplateFolder: PrismaRepository<'designTemplateFolder'>,
    private readonly _designVersion: PrismaRepository<'designVersion'>,
    private readonly _file: PrismaRepository<'file'>
  ) {}

  findById(orgId: string, id: string) {
    return this._design.model.design.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  findByOrg(orgId: string, page: number = 1, limit: number = 20) {
    return this._design.model.design.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { previewFile: { select: { path: true } } },
    });
  }

  countByOrg(orgId: string) {
    return this._design.model.design.count({
      where: { organizationId: orgId, deletedAt: null },
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

  // DesignTemplate methods
  // No page/limit = the historical full list (callers that group/bucket the
  // whole gallery in memory). Both present = one page plus a count via
  // countTemplatesByOrg.
  findTemplatesByOrg(orgId: string, page?: number, limit?: number) {
    return this._designTemplate.model.designTemplate.findMany({
      where: {
        deletedAt: null,
        OR: [{ organizationId: orgId }, { isSystem: true }],
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      ...(page !== undefined && limit !== undefined
        ? { skip: (page - 1) * limit, take: limit }
        : {}),
      include: { thumbnailFile: { select: { path: true } } },
    });
  }

  countTemplatesByOrg(orgId: string) {
    return this._designTemplate.model.designTemplate.count({
      where: {
        deletedAt: null,
        OR: [{ organizationId: orgId }, { isSystem: true }],
      },
    });
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
  }) {
    return this._designTemplate.model.designTemplate.create({ data });
  }

  updateTemplate(id: string, orgId: string, data: { name?: string; category?: string; doc?: any; thumbnailFileId?: string }) {
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
