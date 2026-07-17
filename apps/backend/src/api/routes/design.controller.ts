import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ApiTags } from '@nestjs/swagger';
import { DesignService } from '@gitroom/nestjs-libraries/database/prisma/design/design.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { DesignRenderService } from '@gitroom/nestjs-libraries/media/design-render/design-render.service';
import { DesignBulkService } from '@gitroom/nestjs-libraries/media/design-render/design-bulk.service';
import { VideoRenderService } from '@gitroom/nestjs-libraries/media/design-render/video-render.service';
import {
  FRAME_RENDERER_SCRIPT,
  escapeForScriptTag,
} from '@gitroom/nestjs-libraries/media/design-render/frame-renderer-script';
import { RenderDesignDto } from '@gitroom/nestjs-libraries/dtos/design/render.design.dto';
import { RenderVideoDesignDto } from '@gitroom/nestjs-libraries/dtos/design/render-video.design.dto';
import { BulkGenerateDesignDto } from '@gitroom/nestjs-libraries/dtos/design/bulk.generate.design.dto';
import { CreateDesignDto } from '@gitroom/nestjs-libraries/dtos/design/create-design.dto';
import { UpdateDesignDto } from '@gitroom/nestjs-libraries/dtos/design/update-design.dto';
import { CreateTemplateDto } from '@gitroom/nestjs-libraries/dtos/design/create-template.dto';
import { UpdateTemplateDto } from '@gitroom/nestjs-libraries/dtos/design/update-template.dto';
import { ValidateDocDto } from '@gitroom/nestjs-libraries/dtos/design/validate-doc.dto';
import { ApplyOpsDto } from '@gitroom/nestjs-libraries/dtos/design/apply-ops.dto';
import type { DesignerDoc } from '@gitroom/nestjs-libraries/media/design-render/design-render.types';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { Response } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  mediaJobWebhookToken,
  verifyMediaJobWebhookToken,
} from '@gitroom/nestjs-libraries/media/media-job-token';

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
    );
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="design.png"');
    res.end(png);
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
    const result = this._designerDocService.applyOps(doc, body.ops ?? []);
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
    return {
      id: job.id,
      status: job.status,
      artifactUrl: job.artifactUrl,
      thumbnailUrl,
      errorMessage: job.status === 'failed' ? job.error : undefined,
      progress: job.status === 'completed' ? 100 : job.status === 'processing' ? 50 : 0,
    };
  }
}

@ApiTags('Design Templates')
@Controller('/media/design-templates')
export class DesignTemplateController {
  constructor(private _designService: DesignService) {}

  @Get('/')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async list(@GetOrgFromRequest() org: Organization) {
    return this._designService.listTemplates(org.id);
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

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this._designService.updateTemplate(org.id, id, body);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTemplateDto,
  ) {
    return this._designService.createTemplate({ organizationId: org.id, ...body });
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
  @Get('/render-frame/:jobId')
  async renderFrame(
    @Param('jobId') jobId: string,
    @Query('token') token: string,
    @Query('frame') frame?: string,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) {
      return;
    }

    if (!token) {
      res.status(403).send('Missing render token');
      return;
    }

    const raw = await ioRedis.get(`video-render:payload:${jobId}`);
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

    const output = payload.composition || {};
    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000';
    const initialFrame = frame ? Number(frame) : undefined;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${baseUrl}">
  <style>body{margin:0;background:#000}</style>
</head>
<body>
  <canvas id="frame-canvas"></canvas>
  <script>
    window.__DATA = {
      output: ${escapeForScriptTag(output)},
      baseUrl: ${escapeForScriptTag(baseUrl)}
    };
    ${FRAME_RENDERER_SCRIPT}
    window.__FRAME_API.preload().then(function () {
      ${initialFrame != null ? `window.__FRAME_API.renderFrame(${initialFrame});` : ''}
    });
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}
