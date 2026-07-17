import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class DesignRepository {
  constructor(
    private readonly _design: PrismaRepository<'design'>,
    private readonly _designTemplate: PrismaRepository<'designTemplate'>,
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

  update(id: string, orgId: string, data: { name?: string; doc?: any; width?: number; height?: number; previewDataUrl?: string; previewFileId?: string }) {
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
}
