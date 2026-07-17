import { Injectable, NotFoundException } from '@nestjs/common';
import { DesignRepository } from '@gitroom/nestjs-libraries/database/prisma/design/design.repository';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDoc } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';

@Injectable()
export class DesignService {
  constructor(
    private readonly _designRepository: DesignRepository,
    private readonly _designerDocService: DesignerDocService,
    private readonly _fileService: FileService,
  ) {}

  async getDesign(orgId: string, id: string) {
    return this._designRepository.findById(orgId, id);
  }

  async listDesigns(orgId: string, page: number = 1, limit: number = 20) {
    const [designs, total] = await Promise.all([
      this._designRepository.findByOrg(orgId, page, limit),
      this._designRepository.countByOrg(orgId),
    ]);
    return { designs, total, page, limit };
  }

  async createDesign(orgId: string, userId: string, data: {
    name: string;
    doc: any;
    width?: number;
    height?: number;
    previewDataUrl?: string;
    previewFileId?: string;
    campaignId?: string;
  }) {
    let payload: any = { ...data, organizationId: orgId, createdById: userId };
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      const firstOutput = validatedDoc.outputs[0];
      payload = {
        ...payload,
        doc: validatedDoc,
        width: firstOutput.width,
        height: firstOutput.height,
      };
    }
    return this._designRepository.create(payload);
  }

  async updateDesign(orgId: string, id: string, data: {
    name?: string;
    doc?: any;
    width?: number;
    height?: number;
    previewDataUrl?: string;
    previewFileId?: string;
  }) {
    let payload: any = { ...data };
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      const firstOutput = validatedDoc.outputs[0];
      payload = {
        ...payload,
        doc: validatedDoc,
        width: firstOutput.width,
        height: firstOutput.height,
      };
    }
    return this._designRepository.update(id, orgId, payload);
  }

  async deleteDesign(orgId: string, id: string) {
    return this._designRepository.softDelete(id, orgId);
  }

  async listTemplates(orgId: string) {
    return this._designRepository.findTemplatesByOrg(orgId);
  }

  async getTemplate(orgId: string, id: string) {
    return this._designRepository.findTemplateForOrg(id, orgId);
  }

  async createTemplate(data: {
    organizationId?: string;
    name: string;
    category: string;
    doc: any;
    isSystem?: boolean;
  }) {
    const validatedDoc = this._designerDocService.validate(data.doc);
    return this._designRepository.createTemplate({
      ...data,
      doc: validatedDoc,
    });
  }

  async updateTemplate(orgId: string, id: string, data: {
    name?: string;
    category?: string;
    doc?: any;
    thumbnailFileId?: string;
  }) {
    let payload: any = { ...data };
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      payload = { ...payload, doc: validatedDoc };
    }
    return this._designRepository.updateTemplate(id, orgId, payload);
  }

  async deleteTemplate(orgId: string, id: string) {
    return this._designRepository.deleteTemplate(id, orgId);
  }

  async instantiateTemplate(orgId: string, templateId: string): Promise<DesignerDoc> {
    const template = await this._designRepository.findTemplateForOrg(templateId, orgId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    const validated = this._designerDocService.validate(template.doc);
    const stripped = this._stripIds(validated);
    return this._designerDocService.assignIdsAndNormalize(stripped);
  }

  private _stripIds(doc: DesignerDoc): DesignerDoc {
    const outputs = doc.outputs.map((out: any) => {
      const base = { ...out };
      delete base.id;
      delete base.originId;
      if ('children' in base) {
        base.children = base.children.map((el: any) => {
          const e = { ...el };
          delete e.id;
          delete e.originId;
          return e;
        });
      }
      if ('tracks' in base) {
        base.tracks = base.tracks.map((track: any) => {
          const t = { ...track };
          delete t.id;
          delete t.originId;
          t.clips = t.clips.map((clip: any) => {
            const c = { ...clip };
            delete c.id;
            delete c.originId;
            return c;
          });
          return t;
        });
      }
      return base;
    });
    return { ...doc, outputs } as DesignerDoc;
  }

  async placeAsset(
    orgId: string,
    doc: DesignerDoc,
    input: {
      url: string;
      outputIndex: number;
      name?: string;
      box?: Partial<{ x: number; y: number; width: number; height: number }>;
    }
  ): Promise<{ doc: DesignerDoc; fileId: string }> {
    const file = await this._fileService.importFromUrl(orgId, {
      url: input.url,
      name: input.name ?? 'placed-asset',
    });

    const op = this._designerDocService.buildPlaceImageOp({
      outputIndex: input.outputIndex,
      src: file.path,
      fileId: file.id,
      box: input.box,
    });

    const updated = this._designerDocService.applyOps(doc, [op]);
    return { doc: updated, fileId: file.id };
  }
}
