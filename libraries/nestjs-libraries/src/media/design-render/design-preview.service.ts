import { Injectable, Logger } from '@nestjs/common';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  docWithVideoPosters,
  VideoPosterMap,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/video-poster';
import { VideoThumbnailService } from '@postmill-ai/nestjs-libraries/media/video-thumbnail.service';

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
    private readonly _videoThumbnailService: VideoThumbnailService,
  ) {}

  /**
   * Poster sources for the video clips a poster projection would draw (the
   * t=0-active ones on video tracks): each clip's File row thumbnail. A file
   * with no thumbnail yet is self-healed — one ffmpeg frame extraction,
   * persisted back onto the File row so later renders skip the extraction.
   * Fail-soft throughout: any resolution/extraction failure just leaves the
   * clip without a poster (it projects as before — skipped).
   */
  private async _resolveVideoPosters(
    doc: DesignerDoc,
    orgId: string
  ): Promise<VideoPosterMap | undefined> {
    try {
      const fileIds = new Set<string>();
      for (const out of doc.outputs ?? []) {
        if (!('tracks' in out)) continue;
        for (const track of out.tracks) {
          if (track.hidden || track.type !== 'video') continue;
          for (const clip of track.clips) {
            if (clip.startMs <= 0 && clip.endMs > 0 && clip.fileId) {
              fileIds.add(clip.fileId);
            }
          }
        }
      }
      if (!fileIds.size) return undefined;

      const posters = new Map<string, string>();
      const files = await this._fileService.getByIds(orgId, [...fileIds]);
      for (const file of files) {
        if (file.thumbnail) posters.set(file.id, file.thumbnail);
      }

      // Self-heal the missing ones — locally stored files only: the preview
      // render is synchronous and must never wait on a remote bucket read.
      for (const fileId of fileIds) {
        if (posters.has(fileId)) continue;
        const extracted = await this._videoThumbnailService.generateForFile(
          orgId,
          fileId,
          { localOnly: true }
        );
        if (extracted) posters.set(fileId, extracted);
      }
      return posters.size ? posters : undefined;
    } catch (err) {
      this._logger.warn(
        `Video poster resolution failed; rendering without posters: ${(err as Error)?.message}`
      );
      return undefined;
    }
  }

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
    if (!isVideo) {
      return this._designRenderService.renderPage(doc, 0, opts);
    }
    const videoPosters = opts?.orgId
      ? await this._resolveVideoPosters(doc, opts.orgId)
      : undefined;
    const renderDoc = docWithVideoPosters(doc, videoPosters);
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
