import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { NO_CREDIT } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.service';
import {
  collectDocFileIds,
  collectDocFontFamilies,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';
import {
  buildPostmillManifest,
  sanitizeDownloadName,
  PostmillAssetEntry,
  PostmillFontEntry,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';
import { fromBuffer } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

/**
 * Async `.pdesign` export (format v2), mirroring the video-render pipeline:
 * an uncosted MediaJobLifecycle pending job (NO_CREDIT — exports never consume
 * a `video_export` credit), a Redis payload key, and a deterministic Inngest
 * event id so an enqueue + sweep re-dispatch inside the same minute dedup.
 *
 * The artifact is a self-contained zip: every referenced media file (read via
 * the folder-resolved storage adapter — unmounted folders resolve to LOCAL)
 * plus the org's custom fonts the doc uses (fonts are local-adapter-only).
 */

export const DESIGN_EXPORT_PROVIDER = 'design-export';
export const DESIGN_EXPORT_EVENT = 'media/design-export';

/** Pre-flight ceiling on summed referenced-asset bytes; past it the job fails with a clear message. */
export const DESIGN_EXPORT_MAX_ASSET_BYTES = 1024 * 1024 * 1024; // 1 GB

const PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

/** Wall-clock budget for a `processing` export before the sweep declares the runner dead. */
export const DESIGN_EXPORT_TIMEOUT_MS = 15 * 60 * 1000;

export const exportPayloadKey = (jobId: string) => `design-export:payload:${jobId}`;
export const exportProgressKey = (jobId: string) => `design-export:progress:${jobId}`;
const exportClaimKey = (jobId: string) => `design-export:claim:${jobId}`;

/** Deterministic event id: a same-minute re-dispatch (enqueue + sweep) dedups. */
export const designExportEventId = (jobId: string) =>
  `design-export-${jobId}-${Math.floor(Date.now() / 60000)}`;

export interface DesignExportPayload {
  organizationId: string;
  userId?: string;
  kind: 'design' | 'template';
  sourceId: string;
  enqueuedAt: string;
}

interface ExportProgress {
  done: number;
  total: number;
  updatedAt: number;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Media/fonts are already compressed (or CPU-heavy to deflate) — store them. */
  compress?: boolean;
}

/** Streaming zip assembly (never zipSync): inputs are pushed entry-by-entry. */
const zipEntries = async (entries: ZipEntry[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        reject(err);
        return;
      }
      chunks.push(Buffer.from(chunk));
      if (final) resolve(Buffer.concat(chunks));
    });
    try {
      for (const entry of entries) {
        const file = entry.compress
          ? new ZipDeflate(entry.name, { level: 6 })
          : new ZipPassThrough(entry.name);
        zip.add(file);
        file.push(entry.data, true);
      }
      zip.end();
    } catch (err) {
      reject(err);
    }
  });

const extFromMime = (mime: string | undefined): string => {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    case 'image/bmp': return 'bmp';
    case 'image/tiff': return 'tiff';
    case 'video/mp4': return 'mp4';
    case 'video/webm': return 'webm';
    case 'video/quicktime': return 'mov';
    case 'audio/mpeg': return 'mp3';
    case 'audio/wav': return 'wav';
    case 'audio/ogg': return 'ogg';
    case 'font/ttf': return 'ttf';
    case 'font/otf': return 'otf';
    case 'font/woff2': return 'woff2';
    default: return 'bin';
  }
};

const pathExtension = (p: string): string | undefined => {
  const clean = p.split('?')[0];
  const base = clean.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : undefined;
};

@Injectable()
export class DesignExportService {
  private readonly _logger = new Logger(DesignExportService.name);

  constructor(
    private _lifecycle: MediaJobLifecycleService,
    private _aiSettings: AiSettingsService,
    private _designService: DesignService,
    private _designerDocService: DesignerDocService,
    private _fileService: FileService,
    private _storageService: StorageService,
    private _brandsService: BrandsService,
  ) {}

  /** Org-scoped status read (mirrors VideoRenderService.getJob). */
  async getJob(orgId: string, jobId: string) {
    const job = await this._aiSettings.getMediaJobById(orgId, jobId);
    if (!job || job.organizationId !== orgId || job.provider !== DESIGN_EXPORT_PROVIDER) {
      return null;
    }
    return job;
  }

  async getProgress(jobId: string): Promise<ExportProgress | null> {
    try {
      const raw = await ioRedis.get(exportProgressKey(jobId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Number.isFinite(parsed?.done) || !Number.isFinite(parsed?.total)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Load + validate the source doc EAGERLY so the route 404s/400s at enqueue
   * time rather than minutes later inside the job.
   */
  private async _loadSource(
    orgId: string,
    source: { kind: 'design' | 'template'; id: string }
  ): Promise<{ name: string; doc: DesignerDoc; previewPath: string | null }> {
    const row =
      source.kind === 'design'
        ? await this._designService.getDesign(orgId, source.id)
        : await this._designService.getTemplate(orgId, source.id);
    if (!row) {
      throw new NotFoundException(
        source.kind === 'design' ? 'Design not found' : 'Template not found'
      );
    }
    return {
      name: row.name,
      doc: this._designerDocService.validate(row.doc),
      previewPath: await this._resolvePreviewPath(orgId, source.kind, row),
    };
  }

  /**
   * Path of the file the design/template currently points at as its preview.
   * Best-effort: a replaced (soft-deleted) or cross-org pointer resolves to
   * null — the export simply ships without a thumbnail.
   */
  private async _resolvePreviewPath(
    orgId: string,
    kind: 'design' | 'template',
    row: unknown
  ): Promise<string | null> {
    try {
      const fileId =
        kind === 'design'
          ? (row as { previewFileId?: string | null }).previewFileId
          : (row as { thumbnailFileId?: string | null }).thumbnailFileId;
      if (!fileId) return null;
      const file = await this._fileService.getFileById(orgId, fileId);
      return file?.path ?? null;
    } catch {
      return null;
    }
  }

  async enqueueExport(
    orgId: string,
    userId: string,
    source: { kind: 'design' | 'template'; id: string }
  ) {
    // Validates existence + schema up front; the job re-loads at run time so a
    // stale payload never exports a superseded doc version.
    await this._loadSource(orgId, source);

    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId,
      provider: DESIGN_EXPORT_PROVIDER,
      operation: 'design-export',
      costUsd: 0,
      creditType: NO_CREDIT,
    });

    const payload: DesignExportPayload = {
      organizationId: orgId,
      userId,
      kind: source.kind,
      sourceId: source.id,
      enqueuedAt: new Date().toISOString(),
    };
    await ioRedis.set(exportPayloadKey(job.id), JSON.stringify(payload), 'EX', PAYLOAD_TTL_SECONDS);

    await this.dispatch(job.id);

    this._logger.log(`Enqueued design export job ${job.id} (${source.kind} ${source.id}) for org ${orgId}`);
    return { id: job.id, status: job.status };
  }

  /** Send the media/design-export event; no-op when Inngest is off (the sweep drives it inline). */
  private async dispatch(jobId: string) {
    if (isInngestEnabled()) {
      await inngest.send({
        name: DESIGN_EXPORT_EVENT,
        data: { jobId },
        id: designExportEventId(jobId),
      });
    }
  }

  /** Job-id-only Inngest/sweep entry point: unscoped lookup, org-scoped updates. */
  async processExport(jobId: string): Promise<void> {
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job || job.provider !== DESIGN_EXPORT_PROVIDER || job.status !== 'pending') {
      return;
    }
    const orgId = job.organizationId;

    const raw = await ioRedis.get(exportPayloadKey(jobId));
    // Exactly-once claim (SET NX): a re-dispatched loser must not fail the job
    // the winner is exporting. A missing payload with the job still pending is
    // a genuine TTL-expiry failure.
    const claimed =
      raw != null &&
      (await ioRedis.set(exportClaimKey(jobId), '1', 'EX', PAYLOAD_TTL_SECONDS, 'NX')) !== null;
    if (!raw) {
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: 'Export payload expired — please re-export the design',
      });
      return;
    }
    if (!claimed) {
      return;
    }

    await this._aiSettings.updateMediaJob(orgId, jobId, { status: 'processing' });

    try {
      const payload = JSON.parse(raw) as DesignExportPayload;
      const { name, bytes, previewPath } = await this._buildBundle(orgId, jobId, payload);

      const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
      const path = await adapter.writeBuffer(bytes, 'application/zip');
      const created = await this._fileService.saveGeneratedMedia(orgId, {
        name: `${sanitizeDownloadName(name)}.pdesign`,
        path,
        type: 'document',
        fileSize: bytes.length,
        metadata: {
          source: 'design-export',
          mime: 'application/zip',
          kind: payload.kind,
          [`${payload.kind}Id`]: payload.sourceId,
        },
      });

      // COPY the source preview as the artifact thumbnail — never reference
      // the preview file itself: DesignService._cleanupReplacedFile
      // soft-deletes it the moment autosave replaces the design preview.
      // Best-effort: an export must never fail over a thumbnail.
      if (previewPath) {
        try {
          const previewBytes = await adapter.readFile(previewPath);
          const ext = pathExtension(previewPath);
          const copiedPath = await adapter.writeBuffer(
            previewBytes,
            ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
          );
          await this._fileService.saveMediaInformation(orgId, {
            id: created.id,
            thumbnail: copiedPath,
            alt: '',
            thumbnailTimestamp: 0,
          });
        } catch (err) {
          this._logger.warn(
            `Design export ${jobId}: preview thumbnail copy failed: ${(err as Error)?.message}`
          );
        }
      }

      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'completed',
        artifactUrl: path,
        error: null,
      });
      this._logger.log(`Design export job ${jobId} completed (${bytes.length} bytes)`);
    } catch (err) {
      const message = (err as Error)?.message || 'Export failed';
      this._logger.warn(`Design export job ${jobId} failed: ${message}`);
      await this._aiSettings.updateMediaJob(orgId, jobId, { status: 'failed', error: message });
    }
  }

  /**
   * Bundle the doc + every referenced asset + the used custom fonts into the
   * v2 zip. Referenced files that no longer resolve in the org are SKIPPED
   * (the doc already renders them broken); the byte ceiling is enforced on
   * recorded sizes up front and re-checked against actual bytes read.
   */
  private async _buildBundle(
    orgId: string,
    jobId: string,
    payload: DesignExportPayload
  ): Promise<{ name: string; bytes: Buffer; previewPath: string | null }> {
    const { name, doc, previewPath } = await this._loadSource(orgId, {
      kind: payload.kind,
      id: payload.sourceId,
    });

    const fileIds = [...collectDocFileIds(doc)];
    const files = [];
    for (const id of fileIds) {
      const file = await this._fileService.getFileById(orgId, id);
      if (file) files.push(file);
    }

    const recordedTotal = files.reduce((sum, f) => sum + (f.fileSize || 0), 0);
    if (recordedTotal > DESIGN_EXPORT_MAX_ASSET_BYTES) {
      throw new Error(
        `Design assets total ${Math.ceil(recordedTotal / 1024 / 1024)} MB — over the 1 GB export ceiling`
      );
    }

    const manifestAssets: Record<string, PostmillAssetEntry> = {};
    const assetEntries: ZipEntry[] = [];
    let actualTotal = 0;
    let done = 0;
    const total = files.length;
    for (const file of files) {
      const adapter = await this._storageService.resolveAdapterForFolder(file.folderId, orgId);
      const bytes = await adapter.readFile(file.path);
      actualTotal += bytes.length;
      if (actualTotal > DESIGN_EXPORT_MAX_ASSET_BYTES) {
        throw new Error('Design assets exceed the 1 GB export ceiling');
      }
      const detected = await fromBuffer(bytes);
      const mime = detected?.mime || 'application/octet-stream';
      const ext = detected?.ext || pathExtension(file.path) || 'bin';
      const zipPath = `assets/${file.id}.${ext}`;
      manifestAssets[file.id] = {
        path: zipPath,
        mime,
        originalName: file.originalName || file.name,
        size: bytes.length,
      };
      assetEntries.push({ name: zipPath, data: bytes });
      done++;
      await this._writeProgress(jobId, done, total);
    }

    // Custom fonts: bundle every org custom-font entry whose family the doc
    // names. Font bytes live on the org LOCAL adapter (fonts are
    // local-adapter-only — see MediaService.uploadFont).
    const families = collectDocFontFamilies(doc);
    const customFonts = (await this._brandsService.getCustomFonts(orgId)).filter((f: any) =>
      families.has(f?.family)
    );
    const manifestFonts: PostmillFontEntry[] = [];
    if (customFonts.length) {
      const fontAdapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
      for (const font of customFonts as any[]) {
        try {
          const bytes = await fontAdapter.readFile(font.path);
          const weight = font.weights?.[0] ?? 400;
          const ext = pathExtension(font.path) || 'ttf';
          const zipPath = `assets/fonts/${sanitizeDownloadName(font.family)}-${weight}${font.italic ? 'i' : ''}.${ext}`;
          manifestFonts.push({
            family: font.family,
            weight,
            ...(font.italic ? { italic: true } : {}),
            path: zipPath,
          });
          assetEntries.push({ name: zipPath, data: bytes });
        } catch (err) {
          // A font whose bytes are gone degrades to a renderer fallback on
          // import — never fail the whole export over it.
          this._logger.warn(
            `Design export ${jobId}: skipping unreadable font ${font.family}: ${(err as Error)?.message}`
          );
        }
      }
    }

    const manifest = buildPostmillManifest(doc, name, manifestAssets, manifestFonts);
    const bytes = await zipEntries([
      { name: 'manifest.json', data: strToU8(JSON.stringify(manifest, null, 2)), compress: true },
      { name: 'doc.json', data: strToU8(JSON.stringify(doc)), compress: true },
      ...assetEntries,
    ]);
    return { name, bytes, previewPath };
  }

  private async _writeProgress(jobId: string, done: number, total: number): Promise<void> {
    try {
      await ioRedis.set(
        exportProgressKey(jobId),
        JSON.stringify({ done, total, updatedAt: Date.now() } satisfies ExportProgress),
        'EX',
        PAYLOAD_TTL_SECONDS
      );
    } catch {
      /* progress is best-effort */
    }
  }
}
