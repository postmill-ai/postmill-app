import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { ApiTags } from '@nestjs/swagger';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { DesignBulkService } from '@postmill-ai/nestjs-libraries/media/design-render/design-bulk.service';
import { VideoRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.service';
import {
  FRAME_RENDERER_SCRIPT,
  escapeForScriptTag,
} from '@postmill-ai/nestjs-libraries/media/design-render/frame-renderer-script';
import { buildFramePage, fontLinksForOutput, fontPreloadsForOutput } from '@postmill-ai/nestjs-libraries/media/design-render/frame-page';
import { RenderDesignDto } from '@postmill-ai/nestjs-libraries/dtos/design/render.design.dto';
import { TextOutlinesDto } from '@postmill-ai/nestjs-libraries/dtos/design/text-outlines.dto';
import { textToOutlines } from '@postmill-ai/nestjs-libraries/media/design-render/text-outlines';
import { FontLoaderService } from '@postmill-ai/nestjs-libraries/media/design-render/font-loader.service';
import { RenderVideoDesignDto } from '@postmill-ai/nestjs-libraries/dtos/design/render-video.design.dto';
import { BulkGenerateDesignDto } from '@postmill-ai/nestjs-libraries/dtos/design/bulk.generate.design.dto';
import { CreateDesignDto } from '@postmill-ai/nestjs-libraries/dtos/design/create-design.dto';
import { UpdateDesignDto } from '@postmill-ai/nestjs-libraries/dtos/design/update-design.dto';
import { CreateDesignVersionDto } from '@postmill-ai/nestjs-libraries/dtos/design/create-design-version.dto';
import { CreateTemplateDto } from '@postmill-ai/nestjs-libraries/dtos/design/create-template.dto';
import { UpdateTemplateDto } from '@postmill-ai/nestjs-libraries/dtos/design/update-template.dto';
import {
  CreateTemplateFolderDto,
  MoveTemplateDto,
  UpdateTemplateFolderDto,
} from '@postmill-ai/nestjs-libraries/dtos/design/template-folder.dto';
import { ValidateDocDto } from '@postmill-ai/nestjs-libraries/dtos/design/validate-doc.dto';
import { ApplyOpsDto } from '@postmill-ai/nestjs-libraries/dtos/design/apply-ops.dto';
import { RenderProgressDto } from '@postmill-ai/nestjs-libraries/dtos/design/render-progress.dto';
import { reportRenderProgress, renderPayloadKey } from '@postmill-ai/nestjs-libraries/media/design-render/render-progress';
import { resolveRenderAsset, isSafeRenderAssetJobId, safeRenderAssetFileName } from '@postmill-ai/nestjs-libraries/media/design-render/render-assets';
import { parseByteRange } from '@postmill-ai/nestjs-libraries/media/design-render/render-asset-files';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.types';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDocOp } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc-ops.schema';
import { DesignExportService } from '@postmill-ai/nestjs-libraries/media/design-export/design-export.service';
import {
  DESIGN_IMPORT_MAX_BYTES,
  DesignImportValidationPipe,
} from '@postmill-ai/nestjs-libraries/upload/design-import.validation';
import type { Response } from 'express';
import * as fs from 'fs';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import * as path from 'path';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import {
  mediaJobWebhookToken,
  verifyMediaJobWebhookToken,
} from '@postmill-ai/nestjs-libraries/media/media-job-token';

// Disk-spooled design-import uploads (up to 1 GB bundled .pdesign files) —
// same pattern as files.controller.ts.
const TMP_UPLOAD_DIR = path.join(tmpdir(), 'postmill-uploads');
try { fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true }); } catch {}

@ApiTags('Design')
@Controller('/media/designs')
export class DesignController {
  constructor(
    private _designService: DesignService,
    private _fileService: FileService,
    private _designRenderService: DesignRenderService,
    private _designBulkService: DesignBulkService,
    private _videoRenderService: VideoRenderService,
    private _designerDocService: DesignerDocService,
    private _fontLoaderService: FontLoaderService,
    private _designExportService: DesignExportService,
  ) {}

  @Get('/')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async list(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this._designService.listDesigns(org.id, Number(page) || 1, Number(limit) || 20);
  }

  @Get('/:id')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async get(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._designService.getDesign(org.id, id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async create(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateDesignDto,
  ) {
    return this._designService.createDesign(org.id, user.id, body);
  }

  /**
   * Import a `.pdesign` (zip, format v1 or v2) or raw `.json` DesignerDoc as a
   * NEW design. Static segment declared before the parameterized `/:id` routes
   * so it can never be captured as an id. The pipe is bound to the FILE param
   * only — a method-scoped binding would run on org/body params too and reject
   * them (see files.controller.pipes.spec.ts). Disk-spooled (1 GB cap): v2
   * files bundle every referenced asset, so memory storage is not an option.
   */
  @Post('/import')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: TMP_UPLOAD_DIR }),
    limits: { fileSize: DESIGN_IMPORT_MAX_BYTES },
  }))
  async import(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @UploadedFile(new DesignImportValidationPipe()) file: Express.Multer.File,
  ) {
    try {
      return await this._designService.importDesign(org.id, user.id, file);
    } finally {
      // The temp spool file is always removed, success or failure.
      if (file?.path) { try { await fs.promises.unlink(file.path); } catch { /* best-effort */ } }
    }
  }

  /**
   * Start an async `.pdesign` bundle export (format v2: doc + all referenced
   * assets + used custom fonts) — mirrors the render-video enqueue/poll
   * pattern. Returns the job id; poll GET /media/designs/export/:jobId.
   */
  @Post('/:id/export')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async export(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
  ) {
    return this._designExportService.enqueueExport(org.id, user.id, { kind: 'design', id });
  }

  /**
   * Poll a design-export job. The Designer polls this every 2s after enqueue —
   * the throttle override mirrors render-video status so the global 600/h
   * backstop doesn't eat the polls.
   */
  @Get('/export/:jobId')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  @Throttle({ default: { limit: 2000, ttl: 3600000 } })
  async getExportStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('jobId') jobId: string,
  ) {
    const job = await this._designExportService.getJob(org.id, jobId);
    if (!job) throw new NotFoundException();
    let progress = 0;
    if (job.status === 'completed') {
      progress = 100;
    } else if (job.status === 'processing') {
      const reported = await this._designExportService.getProgress(jobId);
      progress =
        reported && reported.total > 0
          ? Math.min(99, Math.round((reported.done / reported.total) * 100))
          : 50;
    }
    return {
      id: job.id,
      status: job.status,
      artifactUrl: job.status === 'completed' ? job.artifactUrl : undefined,
      errorMessage: job.status === 'failed' ? job.error : undefined,
      progress,
    };
  }

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateDesignDto,
  ) {
    return this._designService.updateDesign(org.id, id, body);
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    await this._designService.deleteDesign(org.id, id);
    return { success: true };
  }

  /**
   * Maintenance: regenerate server-side previews for the caller's org —
   * designs whose preview is missing or whose doc is video-mode (the client
   * live-stage snapshot is a black frame), same for template thumbnails.
   * Bounded and fail-soft per item; returns per-kind counts.
   */
  @Post('/maintenance/regen-previews')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async regenPreviews(@GetOrgFromRequest() org: Organization) {
    return this._designService.regenPreviews(org.id);
  }

  // ── Version history ─────────────────────────────────────────────────────

  @Get('/:id/versions')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async listVersions(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._designService.listVersions(org.id, id);
  }

  @Post('/:id/versions')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async createVersion(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CreateDesignVersionDto,
  ) {
    return this._designService.createVersion(org.id, user.id, id, body);
  }

  @Get('/:id/versions/:vid')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getVersion(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('vid') vid: string,
  ) {
    return this._designService.getVersion(org.id, id, vid);
  }

  /**
   * Restore is non-destructive server-side: the live doc is snapshotted as an
   * auto version before the overwrite (see DesignService.restoreVersion).
   */
  @Post('/:id/versions/:vid/restore')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async restoreVersion(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('vid') vid: string,
  ) {
    return this._designService.restoreVersion(org.id, user.id, id, vid);
  }

  @Delete('/:id/versions/:vid')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async deleteVersion(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('vid') vid: string,
  ) {
    return this._designService.deleteVersion(org.id, id, vid);
  }

  @Post('/render')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async render(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RenderDesignDto,
    @Res() res: Response,
  ): Promise<void> {
    const doc = this._designerDocService.validate(body.doc);
    const opts = { pixelRatio: body.pixelRatio, transparent: body.transparent, orgId: org.id };

    if (body.format === 'pdf') {
      const pdf = await this._designRenderService.renderPdf(doc, opts);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="design.pdf"');
      res.end(pdf);
      return;
    }

    const png = await this._designRenderService.renderPage(
      doc,
      body.outputIndex ?? body.pageIndex ?? 0,
      opts,
      body.pageNumber ?? 0,
    );
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="design.png"');
    res.end(png);
  }

  /**
   * Text -> `path` elements.
   *
   * Server-side because glyph contours live in the font file's own tables and
   * no canvas API — browser or node — exposes them. The font is already on
   * disk: every family a render uses is downloaded and cached by
   * `FontLoaderService`.
   */
  @Post('/text-outlines')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async textOutlines(
    @GetOrgFromRequest() org: Organization,
    @Body() body: TextOutlinesDto,
  ): Promise<{ elements: unknown[]; reason?: string }> {
    const el = body.element as any;
    if (el?.type !== 'text' || typeof el.text !== 'string' || !el.text) {
      return { elements: [], reason: 'not-text' };
    }
    // The element arrives as a free object (an unsaved edit has no id to load),
    // so it never passed the document schema — bound the fields that drive CPU.
    // One path element per glyph contour makes a megabyte of text a render
    // farm's worth of bezier extraction.
    if (
      el.text.length > 5000 ||
      !(el.width > 0) || el.width > 20000 ||
      !(el.height > 0) || el.height > 20000 ||
      (el.fontSize != null && !(el.fontSize > 0 && el.fontSize <= 2000))
    ) {
      return { elements: [], reason: 'out-of-bounds' };
    }

    const fontPath = await this._fontLoaderService.resolveFontFile(
      org.id,
      el.fontFamily || 'Arial',
      el.fontWeight || 400,
    );
    // A font we could not fetch, or one that only exists as WOFF2, yields
    // nothing and says so — rather than outlines in the wrong typeface.
    if (!fontPath) return { elements: [], reason: 'font-unavailable' };

    return {
      elements: await textToOutlines(el, { fontPath, perGlyph: body.perGlyph !== false }),
    };
  }

  @Post('/bulk-generate')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async bulkGenerate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkGenerateDesignDto,
  ) {
    const doc = this._designerDocService.validate(body.doc);
    const { images, truncated, totalRows } =
      await this._designBulkService.generateBatch(doc, body.rows, {
        orgId: org.id,
      });

    return {
      images: images.map(
        (buf) => `data:image/png;base64,${buf.toString('base64')}`,
      ),
      truncated,
      totalRows,
    };
  }

  @Post('/validate')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async validateDoc(
    @Body() body: ValidateDocDto,
  ) {
    try {
      this._designerDocService.validate(body.doc);
      return { valid: true };
    } catch (err: any) {
      if (err?.getStatus?.() === 400) {
        return { valid: false, errors: err.response?.issues ?? err.response?.message ?? err.message };
      }
      throw err;
    }
  }

  @Post('/apply-ops')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async applyOps(
    @Body() body: ApplyOpsDto,
  ) {
    const doc = this._designerDocService.validateStrict(body.doc);
    // The DTO types ops as Record<string, any>[]; applyOps strict-parses them
    // against DesignerDocOpsSchema on entry, so the cast is checked at runtime.
    const result = this._designerDocService.applyOps(doc, (body.ops ?? []) as DesignerDocOp[]);
    return { doc: result };
  }

  @Post('/render-video')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.MEDIA],
    [AuthorizationActions.Create, Sections.VIDEO_EXPORTS]
  )
  @RequirePermission('media', 'create')
  async renderVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RenderVideoDesignDto,
  ) {
    return this._videoRenderService.enqueueRender(org.id, body);
  }

  @Get('/render-video/:jobId')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  // The Designer export dialog polls this every 2s, once per queued output (1800/h per
  // job), far over the global per-handler/per-org backstop of 600/h.
  @Throttle({ default: { limit: 2000, ttl: 3600000 } })
  async getVideoRenderStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('jobId') jobId: string,
  ) {
    const job = await this._videoRenderService.getJob(org.id, jobId);
    if (!job) throw new NotFoundException();
    let thumbnailUrl: string | undefined;
    if (job.status === 'completed' && job.artifactUrl) {
      const file = await this._fileService.getFileByPath(org.id, job.artifactUrl);
      thumbnailUrl = file?.thumbnail || undefined;
    }
    // Real frame-capture progress when the render has reported it (written to Redis by
    // the in-process capture loop or POSTed by the container worker); the 50 midpoint
    // stays as the fallback until the first report lands.
    let progress = 0;
    if (job.status === 'completed') {
      progress = 100;
    } else if (job.status === 'processing') {
      const reported = await this._videoRenderService.getRenderProgress(jobId);
      progress =
        reported && reported.total > 0
          ? Math.min(99, Math.round((reported.frame / reported.total) * 100))
          : 50;
    }
    return {
      id: job.id,
      status: job.status,
      artifactUrl: job.artifactUrl,
      thumbnailUrl,
      errorMessage: job.status === 'failed' ? job.error : undefined,
      progress,
    };
  }
}

@ApiTags('Design Templates')
@Controller('/media/design-templates')
export class DesignTemplateController {
  private readonly _logger = new Logger(DesignTemplateController.name);

  constructor(
    private _designService: DesignService,
    private _videoRenderService: VideoRenderService,
    private _designExportService: DesignExportService,
  ) {}

  // ── Folder endpoints ─────────────────────────────────────────
  // Declared before '/:id' so the single-segment '/folders' route wins.

  @Get('/folders')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getFolderTree(@GetOrgFromRequest() org: Organization) {
    return this._designService.getFolderTree(org.id);
  }

  @Post('/folders')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async createFolder(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTemplateFolderDto,
  ) {
    return this._designService.createFolder(org.id, body);
  }

  @Put('/folders/:id')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async updateFolder(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateTemplateFolderDto,
  ) {
    return this._designService.updateFolder(org.id, id, body);
  }

  @Delete('/folders/:id')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async deleteFolder(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    // force=true unfiles the folder's contents instead of rejecting (the FKs
    // are ON DELETE SET NULL); the default rejects a non-empty folder with a
    // readable 400.
    @Query('force') force?: string,
  ) {
    await this._designService.deleteFolder(org.id, id, force === 'true');
    return { success: true };
  }

  @Put('/:id/move')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async moveTemplate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: MoveTemplateDto,
  ) {
    return this._designService.moveTemplate(org.id, id, body.folderId || null);
  }

  @Get('/')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async list(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // No params = the historical plain-array response (older clients and other
    // callers depend on the shape). Either param present = one bounded page.
    if (page === undefined && limit === undefined) {
      return this._designService.listTemplates(org.id);
    }
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const safePage = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
    const safeLimit =
      Number.isFinite(limitNum) && limitNum >= 1
        ? Math.min(100, Math.floor(limitNum))
        : 24;
    return this._designService.listTemplates(org.id, safePage, safeLimit);
  }

  @Get('/:id')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async get(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._designService.getTemplate(org.id, id);
  }

  /**
   * Start an async `.pdesign` bundle export of the template's doc (same job
   * pipeline as design export; poll GET /media/designs/export/:jobId).
   */
  @Post('/:id/export')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async export(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
  ) {
    return this._designExportService.enqueueExport(org.id, user.id, { kind: 'template', id });
  }

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    const template = await this._designService.updateTemplate(org.id, id, body);
    this._enqueueAnimatedPreview(org.id, template);
    return template;
  }

  /**
   * Fire-and-forget: a video-mode template gets an animated WebP thumbnail
   * rendered in the background (no `video_export` credit). A failure must
   * never block or fail the template write — the static JPEG thumbnail saved
   * by the client stays as the fallback.
   */
  private _enqueueAnimatedPreview(
    orgId: string,
    template: { id: string; doc?: any } | null | undefined,
  ) {
    const doc = template?.doc;
    if (!template || doc?.mode !== 'video') return;
    const composition = doc?.outputs?.[0];
    if (!composition) return;
    this._videoRenderService
      .enqueueTemplatePreview(orgId, template.id, composition)
      .catch((err) =>
        this._logger.warn(
          `Animated preview enqueue failed for template ${template.id}: ${(err as Error).message}`,
        ),
      );
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTemplateDto,
  ) {
    const template = await this._designService.createTemplate({ organizationId: org.id, ...body });
    this._enqueueAnimatedPreview(org.id, template);
    return template;
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    await this._designService.deleteTemplate(org.id, id);
    return { success: true };
  }
}

@ApiTags('Designer Proxy')
@Controller('/media/designer')
export class DesignerProxyController {
  constructor(private _fileService: FileService) {}

  @Get('/proxy')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async proxyImage(
    @GetOrgFromRequest() org: Organization,
    @Query('fileId') fileId?: string,
    @Query('url') url?: string,
    @Res() res?: Response,
  ): Promise<void> {
    let targetUrl: string | undefined;

    if (fileId) {
      const file = await this._fileService.getFileById(org.id, fileId);
      if (!file) {
        if (!res) return;
        res.status(404).json({ error: 'File not found' });
        return;
      }
      targetUrl = file.path;
    } else if (url) {
      targetUrl = url;
    }

    if (!targetUrl) {
      if (!res) return;
      res.status(400).json({ error: 'fileId or url required' });
      return;
    }

    try {
      const upstream = await safeFetch(targetUrl);
      if (!upstream.ok) {
        if (!res) return;
        res.status(upstream.status).json({ error: 'Upstream fetch failed' });
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        if (!res) return;
        res.status(400).json({ error: 'Not an image' });
        return;
      }

      const contentLength = upstream.headers.get('content-length');
      const maxSize = 20 * 1024 * 1024;
      if (contentLength && parseInt(contentLength) > maxSize) {
        if (!res) return;
        res.status(413).json({ error: 'Image too large' });
        return;
      }

      if (!res) return;
      res.setHeader('Content-Type', contentType);
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const reader = upstream.body?.getReader();
      if (reader) {
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (!res) return;
              res.end();
              return;
            }
            if (!res) return;
            res.write(value);
          }
        };
        pump().catch(() => { if (res) res.end(); });
      } else {
        res.end();
      }
    } catch {
      if (!res) return;
      res.status(502).json({ error: 'Proxy fetch failed' });
    }
  }
}

@ApiTags('Design Render')
@Controller('/media/designs')
export class DesignRenderFrameController {
  constructor(private _brandsService: BrandsService) {}

  /**
   * Progress sink for the container render worker — the pod has no Redis access, so
   * the worker POSTs {frame, total} here (throttled to every 10 frames / 2s, whichever
   * first). Same HMAC job token as render-frame; the org id is read from the render
   * payload. Public controller group (token-gated, no session) — the throttle override
   * keeps the global 600/h backstop from eating reports from a long render.
   */
  @Post('/render-progress/:jobId')
  @Throttle({ default: { limit: 3600, ttl: 3600000 } })
  async renderProgress(
    @Param('jobId') jobId: string,
    @Query('token') token: string,
    @Body() body: RenderProgressDto,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) return;
    const result = await reportRenderProgress(jobId, token || '', body.frame, body.total);
    if (result === 'not-found') {
      res.status(404).send('Render job not found');
      return;
    }
    if (result === 'forbidden') {
      res.status(403).send('Invalid render token');
      return;
    }
    res.status(204).end();
  }

  /**
   * Serves a render media asset pre-downloaded host-side into the job's workdir
   * (see design-render/render-assets.ts). Same HMAC job token as render-frame —
   * the render container carries no session, so the token rides the rewritten
   * URLs in the job payload. Single-range support: Chromium issues range
   * requests while seeking a <video>, and a 200-to-range fallback would make it
   * re-fetch whole clips. The throttle override keeps the global 600/h backstop
   * from starving parallel capture pages on a clip-heavy render. Both route
   * params are allowlist-validated (400) before they reach any path expression.
   */
  @Get('/render-asset/:jobId/:file')
  @Throttle({ default: { limit: 3600, ttl: 3600000 } })
  async renderAsset(
    @Param('jobId') jobId: string,
    @Param('file') fileName: string,
    @Query('token') token: string,
    @Headers('range') range: string | undefined,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) return;
    if (!isSafeRenderAssetJobId(jobId) || !safeRenderAssetFileName(fileName)) {
      res.status(400).send('Invalid render asset reference');
      return;
    }
    const asset = await resolveRenderAsset(jobId, fileName, token || '');
    if (asset.status !== 'ok') {
      res
        .status(asset.status === 'not-found' ? 404 : 403)
        .send(asset.status === 'not-found' ? 'Render asset not found' : 'Invalid render token');
      return;
    }

    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    const byteRange = parseByteRange(range, asset.size);
    if (byteRange.kind === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${asset.size}`).end();
      return;
    }
    if (byteRange.kind === 'partial') {
      const { start, end } = byteRange;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${asset.size}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(asset.filePath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', asset.size);
    fs.createReadStream(asset.filePath).pipe(res);
  }

  @Get('/render-frame/:jobId')
  async renderFrame(
    @Param('jobId') jobId: string,
    @Query('token') token: string,
    @Query('frame') frame?: string,
    @Query('scale') scale?: string,
    @Query('fps') fps?: string,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) {
      return;
    }

    if (!token) {
      res.status(403).send('Missing render token');
      return;
    }

    const raw = await ioRedis.get(renderPayloadKey(jobId));
    if (!raw) {
      res.status(404).send('Render job not found');
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.status(500).send('Invalid render payload');
      return;
    }

    const orgId = payload?.organizationId;
    if (!orgId || !verifyMediaJobWebhookToken(jobId, orgId, token)) {
      res.status(403).send('Invalid render token');
      return;
    }

    const output = { ...(payload.composition || {}) };
    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000';
    const initialFrame = frame ? Number(frame) : undefined;

    // Export-time overrides ride query params (the capture service sets them
    // from the job's options) — the stored composition is never mutated.
    // Clamped here because the params are reachable by anyone with a token.
    const scaleNum = Number(scale);
    if (scale && Number.isFinite(scaleNum)) {
      output.renderScale = Math.max(0.25, Math.min(4, scaleNum));
    }
    const fpsNum = Number(fps);
    if (fps && Number.isFinite(fpsNum)) {
      output.fps = Math.max(1, Math.min(240, Math.round(fpsNum)));
    }

    // Org custom fonts join the catalog `<link>`s as @font-face rules — a
    // caption set in an uploaded brand font otherwise painted in Chromium's
    // default sans. The orgId came from the signed render payload, so this
    // read stays inside the rendering org's own font list.
    const customFonts = await this._brandsService.getCustomFonts(orgId).catch(() => []);

    const html = buildFramePage({
      outputLiteral: escapeForScriptTag(output),
      baseUrlLiteral: escapeForScriptTag(baseUrl),
      baseUrl,
      script: FRAME_RENDERER_SCRIPT,
      initialFrame,
      fontLinks: fontLinksForOutput(output, customFonts),
      fontPreloads: fontPreloadsForOutput(output, customFonts),
    });

    // The frame page pulls clip media cross-origin (uploads/CDN hosts) into a
    // canvas, so helmet's default CSP (default-src 'self', no media-src) would
    // block the render. Replace it with a scoped policy for this page only.
    // 'self' covers the pre-downloaded render assets (render-asset route,
    // same-origin): in production they already match `https:`, but a dev
    // backend serves the page over http, where `https:` would block them.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' https: data: blob:; media-src 'self' https: data: blob:; font-src https://fonts.gstatic.com https: data:; " +
        "connect-src https: 'self'; worker-src blob:",
    );
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}
