import { Injectable, Logger } from '@nestjs/common';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { docWithVideoPosters } from '@postmill-ai/nestjs-libraries/media/designer-doc/video-poster';

/**
 * Server-side design preview rendering.
 *
 * Design/template thumbnails are normally client-side canvas snapshots — fine
 * for image docs, but a video doc snapshots an unpainted (black) stage. This
 * service renders output 0 / page 1 through the node-canvas renderer, going
 * through the t=0 poster projection (`designer-doc/video-poster`) for video
 * docs so no render container is needed.
 */
@Injectable()
export class DesignPreviewService {
  private readonly _logger = new Logger(DesignPreviewService.name);

  constructor(
    private readonly _designRenderService: DesignRenderService,
    private readonly _storageService: StorageService,
    private readonly _fileService: FileService,
  ) {}

  /**
   * Render the preview PNG for a doc. Image docs render output 0 page 1 as-is;
   * video docs are projected to their poster (t=0 composed state) first, since
   * `renderPage` rejects video outputs.
   */
  async renderPreviewBuffer(
    doc: DesignerDoc,
    opts?: { orgId?: string }
  ): Promise<Buffer> {
    const isVideo =
      doc.mode === 'video' ||
      (doc.outputs ?? []).some((out) => 'tracks' in (out as object));
    const renderDoc = isVideo ? docWithVideoPosters(doc) : doc;
    return this._designRenderService.renderPage(renderDoc, 0, opts);
  }

  /**
   * Persist a rendered preview buffer as an internal `design-preview` File row
   * (kept out of the media-library listing) and return its id. Mirrors the
   * upload path the AI Designer saver and `/files/upload-simple` use.
   */
  async uploadPreview(orgId: string, buffer: Buffer): Promise<string> {
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    const path = await adapter.writeBuffer(buffer, 'image/png');
    const fileName = `design-preview-${Date.now()}.png`;
    try {
      const file = await this._fileService.saveFile(
        orgId,
        fileName,
        path,
        fileName,
        undefined,
        buffer.length,
        { internal: 'design-preview' }
      );
      return file.id;
    } catch (err) {
      // The stored object must not leak when the post-write save fails — same
      // delete-on-failure as files.controller's uploadSimple.
      try {
        await adapter.removeFile(path);
      } catch (cleanupErr) {
        this._logger.warn(
          `Could not remove orphaned preview object ${path}: ${(cleanupErr as Error)?.message}`
        );
      }
      throw err;
    }
  }
}
