import { Injectable, Logger } from '@nestjs/common';
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
  /**
   * Register a quota-counted `File` row per rendered page. TRUE only for the
   * final delivery state: the conductor's QC loops re-render every page on
   * every pass, and registering each pass multiplied the org's File rows (and
   * storage quota) by the number of saves. Intermediate saves pass `false` —
   * the page buffers still land in storage (the critic needs reachable URLs,
   * and the previous set is deleted once superseded) but no `File` rows are
   * created; `registerPreviews` mints them once, at delivery.
   */
  registerPreviews?: boolean;
}

/**
 * The single `Design` writer for the AI Designer pipeline: agents compose and
 * return docs, only this service persists them (and their rendered previews).
 */
@Injectable()
export class AiDesignerSaverService {
  private readonly _logger = new Logger(AiDesignerSaverService.name);
  /**
   * Storage paths of the un-registered page buffers, per design. Every
   * intermediate save writes a fresh set; the superseded set is deleted here
   * so a 10-pass QC loop holds one set per design, not ten. The critic reads
   * a set between saves, never across one, so deletion is safe. Cleared by
   * `registerPreviews`, when the final set becomes the delivery files.
   */
  private readonly _transientPreviewPaths = new Map<string, string[]>();

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
    const firstOutput = doc.outputs[0];
    const base = {
      name: options.name || `AI design ${variantId}`,
      doc,
      width: firstOutput?.width ?? 1080,
      height: firstOutput?.height ?? 1080,
      campaignId: options.campaignId,
    };

    if (options.registerPreviews === false) {
      // The row needs nothing from the render, so create it first and key the
      // transient-buffer tracking by its id.
      const design = await this._designService.createDesign(orgId, userId, base);
      const rendered = await this._renderAndPersistFiles(
        orgId,
        doc,
        options,
        design.id
      );
      return { designId: design.id, variantId, ...rendered };
    }

    const rendered = await this._renderAndPersistFiles(orgId, doc, options);
    const design = await this._designService.createDesign(orgId, userId, {
      ...base,
      previewFileId: rendered.outputPreviews[0]?.fileId,
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
      doc,
      options,
      designId
    );

    await this._designService.updateDesign(orgId, designId, {
      doc,
      // No previewFileId when previews are unregistered: there is no File row
      // to point at, and the existing pointer must survive the QC loop.
      ...(options.registerPreviews === false
        ? {}
        : { previewFileId: rendered.outputPreviews[0]?.fileId }),
    });

    return {
      designId,
      variantId,
      ...rendered,
    };
  }

  /**
   * Mint the delivery File rows for a design whose saves ran with
   * `registerPreviews: false`: one row per page, created from the buffers the
   * final save already wrote (NO re-render), plus the Design row's preview
   * pointer. This is the only moment QC-loop renders become quota-counted
   * library files. Returns the previews with their real `fileId`s.
   */
  async registerPreviews(
    orgId: string,
    designId: string,
    result: AiDesignerRenderResult,
    options: SaveOptions = {}
  ): Promise<AiDesignerRenderResult['outputPreviews']> {
    const baseName = options.name || 'ai-design';
    const outputPreviews: AiDesignerRenderResult['outputPreviews'] = [];
    let pageIndex = 0;
    for (const preview of result.outputPreviews) {
      const file = await this._fileService.saveGeneratedMedia(orgId, {
        name: `${baseName}-${preview.formatId || pageIndex}.png`,
        path: preview.url,
        type: 'image/png',
        folderId: options.saveFolderId ?? null,
      });
      outputPreviews.push({ ...preview, fileId: file.id });
      pageIndex++;
    }
    // The tracked buffers are the delivered files now — never deleted.
    this._transientPreviewPaths.delete(designId);
    await this._designService.updateDesign(orgId, designId, {
      previewFileId: outputPreviews[0]?.fileId,
    });
    return outputPreviews;
  }

  private async _renderAndPersistFiles(
    orgId: string,
    doc: DesignerDoc,
    options: SaveOptions,
    designId?: string
  ): Promise<Omit<AiDesignerRenderResult, 'designId' | 'variantId'>> {
    // Render every output once; the contact sheet composites the same buffers
    // (rendering twice would double CPU and re-fetch every image element).
    const pages = await this._renderService.renderAllPages(doc, { orgId });
    const contactSheet = await this._renderService.renderContactSheet(doc, {
      orgId,
      pages,
    });

    // Deterministic text-over-imagery contrast audit on the same page
    // buffers. Non-fatal: a sampling failure must never block a save. The
    // backdrop render (the doc with text hidden) is skipped entirely when no
    // text can sit over imagery — the audit is guaranteed empty then, and a
    // second full render per save is real money inside the QC loops.
    let contrastViolations: AiDesignerRenderResult['contrastViolations'];
    if (this._renderService.docHasTextOverImagery(doc)) {
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
    }

    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    const register = options.registerPreviews !== false;

    // The caller-supplied name is the FULL base — do not append the variantId
    // here. Callers already embed it (or a `-revised` suffix / timestamp) in
    // the name, so appending again compounded on every critic pass:
    // `announcement-<id>-revised-<id>-revised-ig-post.png`.
    const baseName = options.name || 'ai-design';

    const outputPreviews: AiDesignerRenderResult['outputPreviews'] = [];
    const writtenPaths: string[] = [];
    let pageIndex = 0;
    for (const page of pages) {
      const output = doc.outputs[pageIndex];
      const path = await adapter.writeBuffer(page, 'image/png');
      writtenPaths.push(path);
      if (register) {
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
      } else {
        // Unregistered intermediate render: reachable URL for the critic and
        // the progressive preview, but no File row and no quota — the fileId
        // is minted by registerPreviews at delivery.
        outputPreviews.push({
          formatId: output?.formatId || `output-${pageIndex}`,
          fileId: '',
          url: path,
        });
      }
      pageIndex++;
    }

    if (!register && designId) {
      // Superseded intermediate buffers are trash the moment the new set is
      // written. Best-effort: a delete failure must not fail the save.
      const previous = this._transientPreviewPaths.get(designId) ?? [];
      this._transientPreviewPaths.set(designId, writtenPaths);
      for (const stale of previous) {
        try {
          await adapter.removeFile(stale);
        } catch (err) {
          this._logger.warn(
            `Failed to remove a superseded preview buffer ${stale}: ${(err as Error)?.message}`
          );
        }
      }
    }

    // The contact sheet exists ONLY to feed the vision critic — it is a QC
    // artifact (framed, labeled per output), never a deliverable. It rides
    // memory as a data URI: the critic inlines local paths into exactly this
    // shape anyway, and persisting it to storage on every save leaked one
    // file per save with no File row and no cleanup.
    const contactSheetUrl = `data:image/png;base64,${contactSheet.toString('base64')}`;

    return {
      outputPreviews,
      contactSheetUrl,
      ...(contrastViolations ? { contrastViolations } : {}),
    };
  }
}
