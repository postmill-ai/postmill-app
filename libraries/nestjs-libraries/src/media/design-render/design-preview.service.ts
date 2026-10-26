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
   * Resolve every poster required by output 0's visible t=0 video clips. A
   * missing thumbnail is self-healed from local storage; unresolved media is
   * an incomplete render and must fail rather than silently painting black.
   */
  private async _resolveVideoPosters(
    doc: DesignerDoc,
    orgId: string
  ): Promise<VideoPosterMap | undefined> {
    const output = doc.outputs?.[0];
    if (!output || !('tracks' in output)) return undefined;
    const fileIds = new Set<string>();
    const clipsBySrc: Array<{ id: string; src: string }> = [];
    for (const track of output.tracks) {
      if (track.hidden || track.type !== 'video') continue;
      for (const clip of track.clips) {
        if (!(clip.startMs <= 0 && clip.endMs > 0)) continue;
        if ((clip.opacity ?? 1) <= 0 || clip.width === 0 || clip.height === 0) continue;
        if (clip.fileId) fileIds.add(clip.fileId);
        else if (clip.src) clipsBySrc.push({ id: clip.id, src: clip.src });
      }
    }
    if (!fileIds.size && !clipsBySrc.length) return undefined;

    const posters = new Map<string, string>();
    if (fileIds.size) {
      const files = await this._fileService.getByIds(orgId, [...fileIds]);
      for (const file of files) {
        if (file.type === 'image') posters.set(file.id, file.path);
        else if (file.thumbnail) posters.set(file.id, file.thumbnail);
      }
      for (const fileId of fileIds) {
        if (posters.has(fileId)) continue;
        const extracted = await this._videoThumbnailService.generateForFile(
          orgId,
          fileId,
          { localOnly: true }
        );
        if (extracted) posters.set(fileId, extracted);
      }
    }

    for (const clip of clipsBySrc) {
      const file = await this._fileService.getFileByPath(orgId, clip.src);
      if (!file) continue;
      const thumb = file.type === 'image'
        ? file.path
        : file.thumbnail ??
          (await this._videoThumbnailService.generateForFile(orgId, file.id, {
            localOnly: true,
          }));
      if (thumb) posters.set(clip.id, thumb);
    }
    return posters.size ? posters : undefined;
  }

  private _assertRequiredVideoAssets(doc: DesignerDoc, posters?: VideoPosterMap): void {
    const output = doc.outputs?.[0];
    if (!output || !('tracks' in output)) return;
    for (const track of output.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (!(clip.startMs <= 0 && clip.endMs > 0)) continue;
        if ((clip.opacity ?? 1) <= 0 || clip.width === 0 || clip.height === 0) continue;
        if (track.type === 'video') {
          const poster = posters?.get(clip.id) ??
            (clip.fileId ? posters?.get(clip.fileId) : undefined);
          if (!poster) {
            throw new Error(`Required time-zero poster for clip ${clip.id} could not be resolved`);
          }
        } else if (
          (track.type === 'image' || track.type === 'sticker' || track.type === 'raster') &&
          !clip.src && !clip.frames?.[0]?.url && !clip.fileId
        ) {
          throw new Error(`Required time-zero asset for clip ${clip.id} could not be resolved`);
        }
      }
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
      await this._designRenderService.assertVisualAssets(doc, 0);
      return this._designRenderService.renderPage(doc, 0, opts);
    }
    const videoPosters = opts?.orgId
      ? await this._resolveVideoPosters(doc, opts.orgId)
      : undefined;
    this._assertRequiredVideoAssets(doc, videoPosters);
    const renderDoc = docWithVideoPosters(doc, videoPosters);
    await this._designRenderService.assertVisualAssets(renderDoc, 0);
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
