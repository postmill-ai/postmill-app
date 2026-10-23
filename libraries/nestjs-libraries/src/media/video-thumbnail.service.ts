import { Injectable, Logger } from '@nestjs/common';
import { StorageProviderType } from '@prisma/client';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import {
  extractVideoFrame,
  VIDEO_FRAME_MAX_BYTES,
} from '@postmill-ai/nestjs-libraries/media/video-frame';
import {
  inngest,
  isInngestEnabled,
} from '@postmill-ai/nestjs-libraries/inngest/inngest.client';

/**
 * Video file thumbnails (`File.thumbnail`) — one JPEG frame per video, stored
 * next to the video in the same tenant storage. Three consumers:
 * - going forward: uploads (`/files/upload-*`) and provider-downloaded media
 *   jobs enqueue `media/video-thumbnail.generate` (fire-and-forget — never
 *   blocks the upload/completion response);
 * - on demand: the design preview renderer self-heals a missing thumbnail for
 *   LOCALLY stored videos while resolving posters (`localOnly`), so a video
 *   design preview is never black;
 * - backfill: the design preview maintenance sweep backfills the org first.
 *
 * Every method is fail-soft: a video that cannot be decoded keeps a null
 * thumbnail, never an error surfaced to the triggering flow.
 */

export const VIDEO_THUMBNAIL_EVENT = 'media/video-thumbnail.generate';

/** `File.type` holds a bare category ('video') or a legacy full MIME ('video/mp4'). */
const isVideoType = (type: string | null | undefined): boolean =>
  !!type && (type === 'video' || type.startsWith('video/'));

const extFromPath = (p: string): string => {
  const fileName = p.split('?')[0].split('#')[0].split('/').pop() || '';
  const match = /\.([a-z0-9]{2,5})$/i.exec(fileName);
  return match ? match[1].toLowerCase() : 'mp4';
};

@Injectable()
export class VideoThumbnailService {
  private readonly _logger = new Logger(VideoThumbnailService.name);

  constructor(
    private readonly _storageService: StorageService,
    private readonly _fileService: FileService
  ) {}

  /**
   * Fire-and-forget enqueue of thumbnail generation for a freshly stored
   * video File. Gated on Inngest being enabled (like every emitter); send
   * failures are logged, never thrown — the caller's response must not wait
   * on or fail with a thumbnail.
   */
  enqueueGenerate(orgId: string, fileId: string): void {
    if (!isInngestEnabled()) return;
    void inngest
      .send({
        name: VIDEO_THUMBNAIL_EVENT,
        data: { organizationId: orgId, fileId },
      })
      .catch((err) => {
        this._logger.warn(
          `Could not enqueue video thumbnail for file ${fileId}: ${(err as Error)?.message}`
        );
      });
  }

  /**
   * Generate + persist the thumbnail for one video File. Idempotent: a file
   * that already has a thumbnail returns it unchanged. `localOnly` restricts
   * extraction to the org's LOCAL storage adapter — the synchronous preview
   * path never waits on a remote bucket read. Returns the thumbnail path, or
   * null when none could be produced; never throws.
   */
  async generateForFile(
    orgId: string,
    fileId: string,
    opts?: { localOnly?: boolean }
  ): Promise<string | null> {
    try {
      const file = await this._fileService.getFileById(orgId, fileId);
      if (!file || !isVideoType(file.type)) return null;
      if (file.thumbnail) return file.thumbnail;
      if (file.fileSize > VIDEO_FRAME_MAX_BYTES) return null;

      const adapter = await this._storageService.resolveAdapterForFolder(
        file.folderId,
        orgId
      );
      if (opts?.localOnly && adapter.type !== StorageProviderType.LOCAL) {
        return null;
      }

      const buffer = await adapter.readFile(file.path);
      const frame = await extractVideoFrame(buffer, extFromPath(file.path));
      if (!frame) return null;

      // Land the thumbnail beside the video (same adapter), then point the
      // File row at it — the same shape completeJobWithBuffer persists.
      const thumbnailPath = await adapter.writeBuffer(frame, 'image/jpeg');
      await this._fileService.saveMediaInformation(orgId, {
        id: file.id,
        thumbnail: thumbnailPath,
        alt: file.alt ?? '',
        thumbnailTimestamp: 0,
      });
      return thumbnailPath;
    } catch (err) {
      this._logger.warn(
        `Video thumbnail generation failed for file ${fileId}: ${(err as Error)?.message}`
      );
      return null;
    }
  }

  /**
   * Bounded backfill for one org: video files with no thumbnail, oldest
   * first. Small fixed concurrency — extraction spawns ffmpeg, so a wide
   * fan-out would stall the API process. Per-file failures are counted,
   * never abort the run.
   */
  async backfillOrgThumbnails(orgId: string, limit = 100) {
    const rows = await this._fileService.findVideosWithoutThumbnail(orgId, limit);
    const stats = { scanned: rows.length, generated: 0, failed: 0 };
    const CONCURRENCY = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        const out = await this.generateForFile(orgId, row.id);
        if (out) {
          stats.generated++;
        } else {
          stats.failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return stats;
  }
}
