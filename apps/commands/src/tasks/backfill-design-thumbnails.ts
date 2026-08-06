import { Command, Positional } from 'nestjs-command';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { ChromiumFrameCaptureService } from '@postmill-ai/nestjs-libraries/media/design-render/chromium-frame-capture.service';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.types';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

@Injectable()
export class BackfillDesignThumbnails {
  private readonly _logger = new Logger(BackfillDesignThumbnails.name);

  constructor(
    private _prisma: PrismaService,
    private _designRenderService: DesignRenderService,
    private _fileService: FileService,
    private _storageService: StorageService,
    private _chromiumFrameCapture: ChromiumFrameCaptureService
  ) {}

  @Command({
    command: 'backfill:design-thumbnails [org]',
    describe:
      'Idempotently render and persist preview thumbnails for designs and org design templates that have none (optional org id limits the run to one organization)',
  })
  async run(
    @Positional({
      name: 'org',
      describe: 'Organization id to process (omit to process all orgs)',
      type: 'string',
    })
    org?: string
  ) {
    const orgFilter = org ? { organizationId: org } : {};
    let processed = 0;
    let updated = 0;
    let skipped = 0;

    // Designs with no preview at all — re-run only picks up rows still missing
    // one, so the command is idempotent. Cursor-batched so a large backlog
    // never loads every row's full doc JSON into memory at once.
    let designCursor: string | undefined;
    for (;;) {
      const designs = await this._prisma.design.findMany({
        where: {
          deletedAt: null,
          previewFileId: null,
          previewDataUrl: null,
          ...orgFilter,
        },
        select: { id: true, organizationId: true, name: true, doc: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(designCursor ? { skip: 1, cursor: { id: designCursor } } : {}),
      });
      if (designs.length === 0) break;

      for (const design of designs) {
        processed++;
        try {
          const file = await this._renderAndPersist(
            design.organizationId,
            design.doc as unknown as DesignerDoc,
            `design-${design.id}-thumbnail.png`
          );
          await this._prisma.design.update({
            where: { id: design.id },
            data: { previewFileId: file.id },
          });
          updated++;
        } catch (err) {
          skipped++;
          this._logger.warn(
            `Skipping design ${design.id} ("${design.name}"): ${(err as Error)?.message}`
          );
        }
      }

      designCursor = designs[designs.length - 1].id;
      if (designs.length < 100) break;
    }

    // Org templates only — system templates can't own a File
    // (File.organizationId is required), so they are never touched. Null-org
    // rows are excluded too: there is no org storage to persist a thumbnail to.
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
        select: { id: true, organizationId: true, name: true, doc: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(templateCursor ? { skip: 1, cursor: { id: templateCursor } } : {}),
      });
      if (templates.length === 0) break;

      for (const template of templates) {
        // Unreachable (the where clause filters null orgs) — the guard narrows
        // organizationId from `string | null` for _renderAndPersist.
        if (!template.organizationId) continue;
        processed++;
        try {
          const file = await this._renderAndPersist(
            template.organizationId,
            template.doc as unknown as DesignerDoc,
            `design-template-${template.id}-thumbnail.png`
          );
          await this._prisma.designTemplate.update({
            where: { id: template.id },
            data: { thumbnailFileId: file.id },
          });
          updated++;
        } catch (err) {
          skipped++;
          this._logger.warn(
            `Skipping template ${template.id} ("${template.name}"): ${(err as Error)?.message}`
          );
        }
      }

      templateCursor = templates[templates.length - 1].id;
      if (templates.length < 100) break;
    }

    this._logger.log(
      `Design thumbnail backfill complete: processed=${processed} updated=${updated} skipped=${skipped}`
    );
    return true;
  }

  // Render output 0 to a PNG and store it as a File the same way
  // /files/upload-simple does: org storage adapter write, then FileService.saveFile.
  private async _renderAndPersist(
    orgId: string,
    doc: DesignerDoc,
    name: string
  ) {
    const png = await this._renderThumbnail(orgId, doc);
    const { adapter } =
      await this._storageService.resolveAdapterForFolderWithConfigId(
        undefined,
        orgId
      );
    const path = await adapter.writeBuffer(png, 'image/png');
    return this._fileService.saveFile(orgId, name, path, name, undefined, png.length);
  }

  /**
   * One PNG for output 0, whatever kind of output it is.
   *
   * A video output has no `children` for the still renderer, so it was skipped
   * outright and every video design kept a permanent "No preview" card. Its
   * first frame IS the natural thumbnail — captured through the same Chromium
   * page the video renderer drives, at an fps chosen so the frame count is
   * exactly one (frame 0, t=0).
   */
  private async _renderThumbnail(orgId: string, doc: DesignerDoc): Promise<Buffer> {
    const output = doc.outputs?.[0] as { children?: unknown; durationMs?: number } | undefined;
    if (!output) throw new Error('Design has no outputs');

    if ('children' in output) {
      return this._designRenderService.renderPage(doc, 0, { orgId });
    }

    const durationSeconds = Math.max(1, (output.durationMs ?? 1000) / 1000);
    const frameDir = await mkdtemp(join(tmpdir(), 'design-thumb-'));
    try {
      // ceil(duration * fps) === 1 -> a single frame at t=0.
      await this._chromiumFrameCapture.captureFrames(
        output as never,
        1 / (durationSeconds + 1),
        frameDir
      );
      return await readFile(join(frameDir, 'frame-00001.png'));
    } finally {
      await rm(frameDir, { recursive: true, force: true });
    }
  }
}
