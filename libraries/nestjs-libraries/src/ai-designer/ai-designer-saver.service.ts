import { Injectable } from '@nestjs/common';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
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
    const rendered = await this._renderAndPersistFiles(orgId, doc, options);

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
    const rendered = await this._renderAndPersistFiles(orgId, doc, options);

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

    // Deterministic text-over-imagery contrast audit on the same page
    // buffers. Non-fatal: a sampling failure must never block a save.
    let contrastViolations: AiDesignerRenderResult['contrastViolations'];
    try {
      // The audit judges each text box against a BACKDROP render (the doc
      // with text hidden) so a box's own glyphs don't dominate its measured
      // variance. Rendered here and threaded through so the pipeline renders
      // exactly twice — composite + backdrop — however often it audits.
      // Fail-soft: a backdrop failure falls back to the composite.
      let backdrops = pages;
      try {
        backdrops = await this._renderService.renderAllPages(doc, {
          orgId,
          hideText: true,
        });
      } catch {
        backdrops = pages;
      }
      const found = await this._renderService.auditTextContrast(
        doc,
        pages,
        backdrops
      );
      if (found.length > 0) contrastViolations = found;
    } catch {
      contrastViolations = undefined;
    }

    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);

    // The caller-supplied name is the FULL base — do not append the variantId
    // here. Callers already embed it (or a `-revised` suffix / timestamp) in
    // the name, so appending again compounded on every critic pass:
    // `announcement-<id>-revised-<id>-revised-ig-post.png`.
    const baseName = options.name || 'ai-design';

    const outputPreviews: AiDesignerRenderResult['outputPreviews'] = [];
    let pageIndex = 0;
    for (const page of pages) {
      const output = doc.outputs[pageIndex];
      const path = await adapter.writeBuffer(page, 'image/png');
      const file = await this._fileService.saveGeneratedMedia(orgId, {
        name: `${baseName}-${output?.formatId || pageIndex}.png`,
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

    // The contact sheet exists ONLY to feed the vision critic — it is a QC
    // artifact (framed, labeled per output), never a deliverable. It is
    // written to storage for the critic to read (local /uploads paths are
    // inlined by the critic) but deliberately NOT persisted as a `File` row,
    // so it never appears in the org's Files library.
    const contactPath = await adapter.writeBuffer(contactSheet, 'image/png');

    return {
      outputPreviews,
      contactSheetUrl: contactPath,
      ...(contrastViolations ? { contrastViolations } : {}),
    };
  }
}
