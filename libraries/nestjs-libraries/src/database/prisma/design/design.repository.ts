import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class DesignRepository {
  constructor(
    private readonly _design: PrismaRepository<'design'>,
    private readonly _designTemplate: PrismaRepository<'designTemplate'>,
    private readonly _designTemplateFolder: PrismaRepository<'designTemplateFolder'>,
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

  // DesignTemplate methods
  findTemplatesByOrg(orgId: string) {
    return this._designTemplate.model.designTemplate.findMany({
      where: {
        deletedAt: null,
        OR: [{ organizationId: orgId }, { isSystem: true }],
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { thumbnailFile: { select: { path: true } } },
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
      include: { _count: { select: { children: true } } },
    });

    if (!folder) {
      return null;
    }

    // Exclude soft-deleted templates: a folder with only trashed templates is
    // deletable. Deleting never touches the templates themselves — a folder
    // with live templates is rejected instead.
    const activeTemplates = await this._designTemplate.model.designTemplate.count({
      where: { folderId: id, organizationId: orgId, deletedAt: null },
    });

    if (activeTemplates > 0 || folder._count.children > 0) {
      throw new Error('Folder is not empty');
    }

    return this._designTemplateFolder.model.designTemplateFolder.delete({
      where: { id, organizationId: orgId },
    });
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
