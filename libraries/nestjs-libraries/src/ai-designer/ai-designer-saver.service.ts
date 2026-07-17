import { Injectable } from '@nestjs/common';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { DesignService } from '@gitroom/nestjs-libraries/database/prisma/design/design.service';
import { DesignRenderService } from '@gitroom/nestjs-libraries/media/design-render/design-render.service';
import type { DesignerDoc } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { AiDesignerRenderResult } from './ai-designer.types';

interface SaveOptions {
  name?: string;
  saveFolderId?: string | null;
  campaignId?: string;
}

/**
 * The single `Design` writer for the AI Designer pipeline: agents compose and
 * return docs, only this service persists them (and their rendered previews).
 */
@Injectable()
export class AiDesignerSaverService {
  constructor(
    private readonly _renderService: DesignRenderService,
    private readonly _storageService: StorageService,
    private readonly _fileService: FileService,
    private readonly _designService: DesignService
  ) {}

  async saveDesign(
    orgId: string,
    userId: string,
    variantId: string,
    doc: DesignerDoc,
    options: SaveOptions = {}
  ): Promise<AiDesignerRenderResult> {
    const rendered = await this._renderAndPersistFiles(
      orgId,
      variantId,
      doc,
      options
    );

    const firstOutput = doc.outputs[0];
    const design = await this._designService.createDesign(orgId, userId, {
      name: options.name || `AI design ${variantId}`,
      doc,
      width: firstOutput?.width ?? 1080,
      height: firstOutput?.height ?? 1080,
      previewFileId: rendered.outputPreviews[0]?.fileId,
      campaignId: options.campaignId,
    });

    return {
      designId: design.id,
      variantId,
      ...rendered,
    };
  }

  /**
   * Re-render an existing design in place (no new `Design` row).
   */
  async updateDesign(
    orgId: string,
    designId: string,
    variantId: string,
    doc: DesignerDoc,
    options: SaveOptions = {}
  ): Promise<AiDesignerRenderResult> {
    const rendered = await this._renderAndPersistFiles(
      orgId,
      variantId,
      doc,
      options
    );

    await this._designService.updateDesign(orgId, designId, {
      doc,
      previewFileId: rendered.outputPreviews[0]?.fileId,
    });

    return {
      designId,
      variantId,
      ...rendered,
    };
  }

  private async _renderAndPersistFiles(
    orgId: string,
    variantId: string,
    doc: DesignerDoc,
    options: SaveOptions
  ): Promise<Omit<AiDesignerRenderResult, 'designId' | 'variantId'>> {
    // Render every output once; the contact sheet composites the same buffers
    // (rendering twice would double CPU and re-fetch every image element).
    const pages = await this._renderService.renderAllPages(doc, { orgId });
    const contactSheet = await this._renderService.renderContactSheet(doc, {
      orgId,
      pages,
    });

    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);

    const outputPreviews: AiDesignerRenderResult['outputPreviews'] = [];
    let pageIndex = 0;
    for (const page of pages) {
      const output = doc.outputs[pageIndex];
      const path = await adapter.writeBuffer(page, 'image/png');
      const file = await this._fileService.saveGeneratedMedia(orgId, {
        name: `${options.name || 'ai-design'}-${variantId}-${output?.formatId || pageIndex}.png`,
        path,
        type: 'image/png',
        folderId: options.saveFolderId ?? null,
        fileSize: page.length,
      });
      outputPreviews.push({
        formatId: output?.formatId || `output-${pageIndex}`,
        fileId: file.id,
        url: file.path,
      });
      pageIndex++;
    }

    const contactPath = await adapter.writeBuffer(contactSheet, 'image/png');
    const contactFile = await this._fileService.saveGeneratedMedia(orgId, {
      name: `${options.name || 'ai-design'}-${variantId}-contact-sheet.png`,
      path: contactPath,
      type: 'image/png',
      folderId: options.saveFolderId ?? null,
      fileSize: contactSheet.length,
    });

    return {
      outputPreviews,
      contactSheetFileId: contactFile.id,
      contactSheetUrl: contactFile.path,
    };
  }
}
