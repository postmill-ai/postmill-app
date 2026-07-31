import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DesignRepository } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.repository';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';

@Injectable()
export class DesignService {
  private readonly _logger = new Logger(DesignService.name);

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
    return {
      designs: designs.map((design) => ({
        ...design,
        previewUrl: (design as any).previewFile?.path ?? design.previewDataUrl ?? null,
      })),
      total,
      page,
      limit,
    };
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
    if (data.previewFileId) {
      await this._assertOwnedFile(orgId, data.previewFileId);
    }
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
    if (data.previewFileId) {
      await this._assertOwnedFile(orgId, data.previewFileId);
    } else if (data.previewDataUrl) {
      // The save fell back to a data-URL preview (thumbnail upload failed) —
      // clear the stale file pointer so the fresher data URL wins in listings.
      payload.previewFileId = null;
    }
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
    // Only look up the previous row when this write moves the preview pointer.
    const previous = payload.previewFileId !== undefined
      ? await this._designRepository.findById(orgId, id)
      : null;
    const updated = await this._designRepository.update(id, orgId, payload);
    await this._cleanupReplacedFile(orgId, previous?.previewFileId, payload.previewFileId);
    return updated;
  }

  async deleteDesign(orgId: string, id: string) {
    return this._designRepository.softDelete(id, orgId);
  }

  async listTemplates(orgId: string) {
    const templates = await this._designRepository.findTemplatesByOrg(orgId);
    return templates.map((t) => ({
      ...t,
      thumbnail: (t as any).thumbnailFile?.path ?? null,
    }));
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
    thumbnailFileId?: string;
  }) {
    if (data.thumbnailFileId) {
      // System templates have no organizationId; running the ownership check
      // with `undefined` would let Prisma ignore it and pass any org's file.
      if (!data.organizationId) {
        throw new BadRequestException(
          'A thumbnail file requires an owning organization'
        );
      }
      await this._assertOwnedFile(data.organizationId, data.thumbnailFileId);
    }
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
    if (data.thumbnailFileId) {
      await this._assertOwnedFile(orgId, data.thumbnailFileId);
    }
    if (data.doc !== undefined) {
      const validatedDoc = this._designerDocService.validate(data.doc);
      payload = { ...payload, doc: validatedDoc };
    }
    // Only look up the previous row when this write moves the thumbnail pointer.
    const previous = data.thumbnailFileId
      ? await this._designRepository.findTemplateForOrg(id, orgId)
      : null;
    const updated = await this._designRepository.updateTemplate(id, orgId, payload);
    await this._cleanupReplacedFile(orgId, previous?.thumbnailFileId, payload.thumbnailFileId);
    return updated;
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

  private async _assertOwnedFile(orgId: string, fileId: string) {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file) {
      throw new BadRequestException('Invalid preview/thumbnail file');
    }
  }

  // Autosave mints a fresh thumbnail File on every save; the replaced one
  // would otherwise orphan and keep counting against the org storage quota.
  // Best-effort: a deletion failure must never fail the design/template write.
  private async _cleanupReplacedFile(
    orgId: string,
    previousFileId: string | null | undefined,
    nextFileId: string | null | undefined
  ) {
    if (!previousFileId || previousFileId === nextFileId) {
      return;
    }
    try {
      await this._fileService.softDelete(previousFileId, orgId);
    } catch (err) {
      this._logger.warn(
        `Could not delete replaced preview file ${previousFileId}: ${(err as Error)?.message}`
      );
    }
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
