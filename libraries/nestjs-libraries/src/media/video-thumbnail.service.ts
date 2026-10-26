import { Injectable, Logger } from '@nestjs/common';
import { StorageProviderType } from '@prisma/client';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import {
  extractVideoFrameInfo,
  VIDEO_FRAME_MAX_BYTES,
} from '@postmill-ai/nestjs-libraries/media/video-frame';
import { fromBuffer } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';
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
 * Every method is fail-soft: undecodable video keeps a null thumbnail, while
 * mislabeled still images and audio-only media are reclassified. Failures are
 * never surfaced to the triggering flow.
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

export interface VideoThumbnailOutcome {
  thumbnail: string | null;
  reclassified?: { type: 'image' | 'audio'; mime: string };
}

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
    opts?: { localOnly?: boolean; force?: boolean }
  ): Promise<string | null> {
    return (await this.generateOutcomeForFile(orgId, fileId, opts)).thumbnail;
  }

  async generateOutcomeForFile(
    orgId: string,
    fileId: string,
    opts?: { localOnly?: boolean; force?: boolean }
  ): Promise<VideoThumbnailOutcome> {
    try {
      const file = await this._fileService.getFileById(orgId, fileId);
      if (!file || !isVideoType(file.type)) return { thumbnail: null };
      if (file.thumbnail && !opts?.force) return { thumbnail: file.thumbnail };
      if (file.fileSize > VIDEO_FRAME_MAX_BYTES) return { thumbnail: null };

      const adapter = await this._storageService.resolveAdapterForFolder(
        file.folderId,
        orgId
      );
      if (opts?.localOnly && adapter.type !== StorageProviderType.LOCAL) {
        return { thumbnail: null };
      }

      const buffer = await adapter.readFile(file.path);
      const detected = await fromBuffer(buffer).catch(() => undefined);
      if (detected?.mime === 'image/jpeg' || detected?.mime === 'image/png') {
        return this._reclassify(orgId, file, 'image', detected.mime);
      }

      const ext = extFromPath(file.path);
      const info = await extractVideoFrameInfo(buffer, ext);
      if (info.hasAudioStream && !info.hasVideoStream) {
        const mime = detected?.mime.startsWith('audio/')
          ? detected.mime
          : detected?.mime.startsWith('video/')
            ? detected.mime.replace(/^video\//, 'audio/')
            : `audio/${ext}`;
        return this._reclassify(orgId, file, 'audio', mime);
      }
      if (!info.frame) return { thumbnail: null };

      const thumbnailPath = await adapter.writeBuffer(info.frame, 'image/jpeg');
      try {
        await this._fileService.saveMediaInformation(orgId, {
          id: file.id,
          thumbnail: thumbnailPath,
          alt: file.alt ?? '',
          thumbnailTimestamp: 0,
        });
      } catch (err) {
        try {
          await adapter.removeFile(thumbnailPath);
        } catch (cleanupErr) {
          this._logger.warn(
            `Could not remove orphaned video thumbnail ${thumbnailPath}: ${(cleanupErr as Error)?.message}`
          );
        }
        throw err;
      }
      if (file.thumbnail && file.thumbnail !== thumbnailPath) {
        try {
          await adapter.removeFile(file.thumbnail);
        } catch (err) {
          this._logger.warn(
            `Could not remove replaced video thumbnail ${file.thumbnail}: ${(err as Error)?.message}`
          );
        }
      }
      return { thumbnail: thumbnailPath };
    } catch (err) {
      this._logger.warn(
        `Video thumbnail generation failed for file ${fileId}: ${(err as Error)?.message}`
      );
      return { thumbnail: null };
    }
  }

  private async _reclassify(
    orgId: string,
    file: { id: string; metadata: unknown },
    type: 'image' | 'audio',
    mime: string,
  ): Promise<VideoThumbnailOutcome> {
    const updated = await this._fileService.reclassifyFile(
      orgId,
      file.id,
      type,
      mime,
      file.metadata,
    );
    return updated.count === 1
      ? { thumbnail: null, reclassified: { type, mime } }
      : { thumbnail: null };
  }

  async repairThumbnails(orgId: string, fileIds: string[]) {
    const ids = [...new Set(fileIds)];
    const stats = { scanned: ids.length, generated: 0, reclassified: 0, failed: 0 };
    const CONCURRENCY = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const fileId = ids[cursor++];
        const out = await this.generateOutcomeForFile(orgId, fileId, { force: true });
        if (out.thumbnail) {
          stats.generated++;
        } else if (out.reclassified) {
          stats.reclassified++;
        } else {
          stats.failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    return stats;
  }

  /**
   * Bounded backfill for one org: video files with no thumbnail, oldest
   * first. Small fixed concurrency — extraction spawns ffmpeg, so a wide
   * fan-out would stall the API process. Per-file failures are counted,
   * never abort the run.
   */
  async backfillOrgThumbnails(orgId: string, limit = 100) {
    const rows = await this._fileService.findVideosWithoutThumbnail(orgId, limit);
    const stats = { scanned: rows.length, generated: 0, reclassified: 0, failed: 0 };
    const CONCURRENCY = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        const out = await this.generateOutcomeForFile(orgId, row.id);
        if (out.thumbnail) {
          stats.generated++;
        } else if (out.reclassified) {
          stats.reclassified++;
        } else {
          stats.failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return stats;
  }
}
