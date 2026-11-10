import { Command, Positional } from 'nestjs-command';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { DesignPreviewService } from '@postmill-ai/nestjs-libraries/media/design-render/design-preview.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

const BATCH_SIZE = 100;

const failureReason = (err: unknown): string =>
  ((err as Error)?.message || 'Unknown error')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/data:\S+/gi, '[data]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);

interface BackfillStats {
  processed: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
}

@Injectable()
export class BackfillDesignThumbnails {
  private readonly _logger = new Logger(BackfillDesignThumbnails.name);

  constructor(
    private _prisma: PrismaService,
    private _designPreviewService: DesignPreviewService,
    private _fileService: FileService,
    private _storageService: StorageService
  ) {}

  @Command({
    command: 'backfill:design-thumbnails [org] [mode]',
    describe:
      'Repair missing design, org-template and design-export thumbnails in batches of 100; mode=dry-run counts candidates without writing',
  })
  async run(
    @Positional({
      name: 'org',
      describe: "Organization id, or 'dry-run' to count all organizations",
      type: 'string',
    })
    org?: string,
    @Positional({
      name: 'mode',
      describe: "Set to 'dry-run' to count candidates without rendering or writing",
      type: 'string',
    })
    mode?: string
  ): Promise<BackfillStats> {
    if (mode && mode !== 'dry-run') {
      throw new Error("Mode must be 'dry-run' when provided");
    }
    const dryRun = mode === 'dry-run' || org === 'dry-run';
    const orgId = org === 'dry-run' ? undefined : org;
    const orgFilter = orgId ? { organizationId: orgId } : {};
    const stats: BackfillStats = { processed: 0, updated: 0, skipped: 0, dryRun };

    let designCursor: string | undefined;
    for (;;) {
      const designs = await this._prisma.design.findMany({
        where: {
          deletedAt: null,
          previewFileId: null,
          previewDataUrl: null,
          ...orgFilter,
        },
        select: { id: true, organizationId: true, doc: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(designCursor ? { skip: 1, cursor: { id: designCursor } } : {}),
      });
      if (!designs.length) break;

      for (const design of designs) {
        stats.processed++;
        if (dryRun) continue;
        let previewFileId: string | undefined;
        let linked = false;
        try {
          previewFileId = await this._renderAndPersist(
            design.organizationId,
            design.doc as unknown as DesignerDoc
          );
          await this._prisma.design.update({
            where: { id: design.id },
            data: { previewFileId },
          });
          linked = true;
          stats.updated++;
        } catch (err) {
          stats.skipped++;
          if (previewFileId && !linked) await this._removePreview(design.organizationId, previewFileId);
          this._warn('design', design.id, err);
        }
      }

      designCursor = designs[designs.length - 1].id;
      if (designs.length < BATCH_SIZE) break;
    }

    let templateCursor: string | undefined;
    for (;;) {
      const templates = await this._prisma.designTemplate.findMany({
        where: {
          deletedAt: null,
          isSystem: false,
          thumbnailFileId: null,
          organizationId: { not: null },
          ...orgFilter,
        },
        select: { id: true, organizationId: true, doc: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(templateCursor ? { skip: 1, cursor: { id: templateCursor } } : {}),
      });
      if (!templates.length) break;

      for (const template of templates) {
        if (!template.organizationId) continue;
        stats.processed++;
        if (dryRun) continue;
        let previewFileId: string | undefined;
        let linked = false;
        try {
          previewFileId = await this._renderAndPersist(
            template.organizationId,
            template.doc as unknown as DesignerDoc
          );
          await this._prisma.designTemplate.update({
            where: { id: template.id },
            data: { thumbnailFileId: previewFileId },
          });
          linked = true;
          stats.updated++;
        } catch (err) {
          stats.skipped++;
          if (previewFileId && !linked) await this._removePreview(template.organizationId, previewFileId);
          this._warn('template', template.id, err);
        }
      }

      templateCursor = templates[templates.length - 1].id;
      if (templates.length < BATCH_SIZE) break;
    }

    let exportCursor: string | undefined;
    for (;;) {
      const exports = await this._prisma.file.findMany({
        where: {
          deletedAt: null,
          thumbnail: null,
          type: 'document',
          metadata: { path: ['source'], equals: 'design-export' },
          ...orgFilter,
        },
        select: {
          id: true,
          organizationId: true,
          folderId: true,
          metadata: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(exportCursor ? { skip: 1, cursor: { id: exportCursor } } : {}),
      });
      if (!exports.length) break;

      for (const artifact of exports) {
        stats.processed++;
        try {
          const source = await this._loadExportSource(artifact);
          if (!source) {
            stats.skipped++;
            this._logger.warn(`Skipping design export ${artifact.id}: source not found`);
            continue;
          }
          if (dryRun) continue;
          const existingPreview = source.previewFileId
            ? await this._readSourcePreview(artifact.organizationId, source.previewFileId)
            : null;
          const png = existingPreview ?? await this._designPreviewService.renderPreviewBuffer(source.doc, {
            orgId: artifact.organizationId,
          });
          const adapter = await this._storageService.resolveAdapterForFolder(
            artifact.folderId,
            artifact.organizationId
          );
          const thumbnail = await adapter.writeBuffer(png, 'image/png');
          try {
            await this._fileService.saveMediaInformation(artifact.organizationId, {
              id: artifact.id,
              thumbnail,
              alt: '',
              thumbnailTimestamp: 0,
            });
          } catch (err) {
            try {
              await adapter.removeFile(thumbnail);
            } catch (cleanupErr) {
              this._logger.warn(
                `Could not remove orphaned export thumbnail for ${artifact.id}: ${failureReason(cleanupErr)}`
              );
            }
            throw err;
          }
          stats.updated++;
        } catch (err) {
          stats.skipped++;
          this._warn('design export', artifact.id, err);
        }
      }

      exportCursor = exports[exports.length - 1].id;
      if (exports.length < BATCH_SIZE) break;
    }

    this._logger.log(
      `Design thumbnail backfill complete: mode=${dryRun ? 'dry-run' : 'apply'} processed=${stats.processed} updated=${stats.updated} skipped=${stats.skipped}`
    );
    return stats;
  }

  private async _renderAndPersist(orgId: string, doc: DesignerDoc): Promise<string> {
    const png = await this._designPreviewService.renderPreviewBuffer(doc, { orgId });
    return this._designPreviewService.uploadPreview(orgId, png);
  }

  private async _readSourcePreview(orgId: string, fileId: string): Promise<Buffer | null> {
    try {
      const file = await this._fileService.getFileById(orgId, fileId);
      if (!file) return null;
      const adapter = await this._storageService.resolveAdapterForFolder(file.folderId, orgId);
      return await adapter.readFile(file.path);
    } catch {
      return null;
    }
  }

  private async _loadExportSource(artifact: {
    organizationId: string;
    metadata: unknown;
  }): Promise<{ doc: DesignerDoc; previewFileId?: string } | null> {
    const metadata =
      artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
        ? artifact.metadata as Record<string, unknown>
        : {};
    const kind = metadata.kind;
    const sourceId = kind === 'design'
      ? metadata.designId
      : kind === 'template'
        ? metadata.templateId
        : undefined;
    if (typeof sourceId !== 'string' || !sourceId) return null;

    if (kind === 'design') {
      const design = await this._prisma.design.findFirst({
        where: {
          id: sourceId,
          organizationId: artifact.organizationId,
          deletedAt: null,
        },
        select: { doc: true, previewFileId: true },
      });
      return design
        ? { doc: design.doc as unknown as DesignerDoc, previewFileId: design.previewFileId ?? undefined }
        : null;
    }

    const template = await this._prisma.designTemplate.findFirst({
      where: {
        id: sourceId,
        organizationId: artifact.organizationId,
        deletedAt: null,
        isSystem: false,
      },
      select: { doc: true, thumbnailFileId: true },
    });
    return template
      ? { doc: template.doc as unknown as DesignerDoc, previewFileId: template.thumbnailFileId ?? undefined }
      : null;
  }

  private async _removePreview(orgId: string, fileId: string): Promise<void> {
    try {
      await this._fileService.deleteFile(orgId, fileId);
    } catch (err) {
      this._logger.warn(`Could not remove unlinked preview ${fileId}: ${failureReason(err)}`);
    }
  }

  private _warn(kind: string, id: string, err: unknown): void {
    this._logger.warn(`Skipping ${kind} ${id}: ${failureReason(err)}`);
  }
}
