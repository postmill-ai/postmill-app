import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';
import { ApiTags } from '@nestjs/swagger';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { StockMediaService } from '@postmill-ai/nestjs-libraries/media/stock/stock-media.service';
import { resolveIconifyIcon } from '@postmill-ai/nestjs-libraries/media/designer-doc/icon-resolver';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { RemoveBackgroundDto } from '@postmill-ai/nestjs-libraries/dtos/ai/remove.background.dto';
import { DetectFocalPointDto } from '@postmill-ai/nestjs-libraries/dtos/ai/detect-focal-point.dto';
import { UpscaleImageDto } from '@postmill-ai/nestjs-libraries/dtos/ai/upscale.image.dto';
import { InpaintImageDto } from '@postmill-ai/nestjs-libraries/dtos/ai/inpaint.image.dto';
import { OutpaintImageDto } from '@postmill-ai/nestjs-libraries/dtos/ai/outpaint.image.dto';
import { ImageToImageDto } from '@postmill-ai/nestjs-libraries/dtos/ai/image-to-image.dto';
import { UpscaleVideoDto } from '@postmill-ai/nestjs-libraries/dtos/ai/upscale-video.dto';
import { RemoveVideoBackgroundDto } from '@postmill-ai/nestjs-libraries/dtos/ai/remove-video-background.dto';
import { GenerateMusicDto } from '@postmill-ai/nestjs-libraries/dtos/ai/generate-music.dto';
import { VideoToVideoDto } from '@postmill-ai/nestjs-libraries/dtos/ai/video-to-video.dto';
import { VideoSegmentTransformDto } from '@postmill-ai/nestjs-libraries/dtos/ai/video-segment-transform.dto';
import { VideoSegmentTransformService } from '@postmill-ai/nestjs-libraries/media/segment/video-segment-transform.service';
import { GenerateAvatarDto } from '@postmill-ai/nestjs-libraries/dtos/ai/generate-avatar.dto';
import { GenerateSlideDto } from '@postmill-ai/nestjs-libraries/dtos/ai/generate-slide.dto';
import { GenerateVideoDto } from '@postmill-ai/backend/dtos/media/generate-video.dto';
import { VoiceoverScriptDto } from '@postmill-ai/nestjs-libraries/dtos/ai/voiceover-script.dto';
import { VideoFunctionDto } from '@postmill-ai/backend/dtos/media/video-function.dto';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { AiDefaultsService, DefaultNotConfiguredError } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { DefaultsResolutionService } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { AiMediaService } from '@postmill-ai/nestjs-libraries/ai/governance/media.service';
import {
  GENERATION_OPERATIONS,
  GenerationOperation,
} from '@postmill-ai/nestjs-libraries/ai/governance/media-operation.types';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { UseFilters } from '@nestjs/common';
import { MediaCapabilityFilter } from '@postmill-ai/backend/api/routes/media-capability.filter';

@ApiTags('Media')
@Controller('/media')
@UseFilters(MediaCapabilityFilter)
export class MediaController {
  private readonly _logger = new Logger(MediaController.name);

  constructor(
    private _aiDefaults: AiDefaultsService,
    private _aiMediaService: AiMediaService,
    private _defaultsResolution: DefaultsResolutionService,
    private _fileService: FileService,
    private _storageService: StorageService,
    private _stockMediaService: StockMediaService,
    private _brandsService: BrandsService,
    private _videoSegmentTransform: VideoSegmentTransformService
  ) {}

  @Post('/generate-video')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GenerateVideoDto
  ) {
    try {
      let artifact: string;
      const prompt = body.output && body.prompt
        ? `[${body.output}] ${body.prompt}`
        : body.prompt || '';
      if (body.imageUrl) {
        artifact = await this._aiDefaults.imageToVideo(org.id, prompt, body.imageUrl);
      } else {
        artifact = await this._aiDefaults.textToVideo(org.id, prompt);
      }
      return { id: artifact, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Get('/jobs/:id')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  async getMediaJob(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    const job = await this._aiMediaService.getJob(id, org.id);
    if (!job || job.organizationId !== org.id) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }
    // Resolve the landed File row so callers (designer timeline) can pin the
    // clip against retention purge — mirrors the studio's `_presentJob`, which
    // resolves the same path→File mapping via getFilesByPaths. The row's
    // content-classified `type` lets the timeline land an image artifact (a
    // video-operation job can store one, e.g. a Reel.Farm slideshow's first
    // slide) as an image clip instead of a dead video clip.
    const completed = job.status === 'completed' && job.artifactUrl;
    const files = completed
      ? await this._fileService.getFilesByPaths(org.id, [job.artifactUrl!]).catch(() => [])
      : [];
    return {
      id: job.id,
      status: job.status,
      artifactUrl: job.artifactUrl,
      fileId: (files[0]?.id as string | undefined) ?? null,
      fileType: (files[0]?.type as string | undefined) ?? null,
      error: job.error,
    };
  }

  @Get('/video-options')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  async getVideoOptions(@GetOrgFromRequest() org: Organization) {
    return this._aiMediaService.getVideoOptions(org.id);
  }

  // Single source of truth for "which media tools can this org actually use". Consumed by
  // Settings (disable), the composer, and the Designer. Guarded with READ/MEDIA only (no
  // @RequirePermission) so it is never stricter than the generate endpoints it gates —
  // Sections.MEDIA is not paywalled, so this won't 402 a user who can otherwise generate.
  @Get('/tools/status')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  async getToolStatus(@GetOrgFromRequest() org: Organization) {
    return this._aiMediaService.getToolStatus(org.id);
  }

  /**
   * Provider/model picker data for the Designer genAI modals: which enabled +
   * credentialed providers may serve a generation type, plus the org's resolved
   * default for it (rendered as `Default (<providerId>/<model>)`). Read-level and
   * reachable by non-admin designers — same guard family as the generate endpoints
   * it feeds, never `media-config:manage`.
   */
  @Get('/generation-providers')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async listGenerationProviders(
    @GetOrgFromRequest() org: Organization,
    @Query('operation') operation?: string,
  ) {
    if (!operation || !(GENERATION_OPERATIONS as readonly string[]).includes(operation)) {
      throw new BadRequestException(
        `operation must be one of: ${GENERATION_OPERATIONS.join(', ')}`
      );
    }
    return this._aiMediaService.listGenerationProviders(
      org.id,
      operation as GenerationOperation
    );
  }

  /**
   * `mdi:rocket` -> the icon's raw SVG body.
   *
   * Insert > Stock Icon routed an Iconify pick through the image path, which
   * stored the API URL as a raster `src` — a 24x24 black square with no fill
   * control. An `icon` element wants the markup itself, and the resolver that
   * produces it (safeFetch + script-stripping + cache) is server-side, so the
   * editor asks for it here rather than reaching api.iconify.design directly
   * past the frontend's connect-src.
   */
  @Get('/icons/resolve')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  async resolveIcon(@Query('name') name: string) {
    // `?name=a&name=b` arrives as an array; the resolver takes a string.
    const requested = typeof name === 'string' ? name : '';
    return (await resolveIconifyIcon(requested)) || { body: null };
  }

  @Post('/video/function')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async videoFunction(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoFunctionDto
  ) {
    if (body.functionName !== 'loadVoices') {
      throw new BadRequestException('Only loadVoices is supported');
    }
    const voices = await this._aiMediaService.listVoices(org.id, { provider: body.identifier });
    return {
      voices: voices.map((v) => ({
        id: v.id,
        name: v.label,
        preview_url: v.previewUrl,
      })),
    };
  }

  @Get('/generate-video/:type/allowed')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  async generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    const categoryMap: Record<string, string> = {
      'text-to-video': 'text-to-video',
      'image-to-video': 'image-to-video',
      'video-to-video': 'video-to-video',
    };
    const category = categoryMap[type];
    if (!category) {
      throw new BadRequestException(`Unknown video type: ${type}`);
    }
    try {
      const resolved = await this._defaultsResolution.resolve('media', category, org.id);
      return { allowed: !!resolved };
    } catch {
      return { allowed: false };
    }
  }

  @Post('/generate-image')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    try {
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new BadRequestException('prompt must be a non-empty string');
      }
      let finalPrompt = prompt;
      // The low-reasoning rewrite exists to expand terse ideas; a prompt that
      // is already detailed only drifts off the user's specifics when
      // rewritten, so it goes to the image model verbatim.
      if (isPicturePrompt && prompt.length <= 120) {
        try {
          const rewritten = await this._aiDefaults.lowReasoningText(
            org.id,
            `Create a concise, vivid image-generation prompt from this idea: ${prompt}`
          );
          // Keep the original alongside the rewrite so details the LLM drops
          // still reach the image model.
          finalPrompt = `${rewritten}\nOriginal request: ${prompt}`;
        } catch (err) {
          // A missing/failing low-reasoning default must not fail the whole
          // request — fall back to the user's prompt as-is.
          this._logger.warn(
            `Image prompt rewrite failed, using the original prompt: ${(err as Error).message}`
          );
        }
      }
      const url = await this._aiDefaults.textToImage(org.id, finalPrompt);
      const dataUrl = await this._aiMediaService.urlToBase64Image(url);
      return { output: dataUrl };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/generate-image-with-prompt')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string
  ) {
    const image = await this.generateImage(org, req, prompt, true);
    if (!image) {
      return false;
    }
    const output = (image as { output: string }).output;
    return this._aiMediaService.saveUrlToFile(org.id, output, 'generated');
  }

  @Post('/remove-background')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async removeBackground(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RemoveBackgroundDto
  ) {
    return { url: await this._aiMediaService.removeBackground(body.imageUrl, { orgId: org.id }) };
  }

  @Post('/inpaint')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async inpaint(
    @GetOrgFromRequest() org: Organization,
    @Body() body: InpaintImageDto
  ) {
    return {
      url: await this._aiMediaService.inpaintImage(
        body.imageUrl,
        body.maskUrl,
        body.prompt,
        { orgId: org.id }
      ),
    };
  }

  @Post('/outpaint')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async outpaint(
    @GetOrgFromRequest() org: Organization,
    @Body() body: OutpaintImageDto
  ) {
    return {
      url: await this._aiMediaService.outpaintImage(
        body.imageUrl,
        body.mode,
        body.prompt,
        { orgId: org.id }
      ),
    };
  }

  @Post('/upscale')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async upscale(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpscaleImageDto
  ) {
    return { url: await this._aiMediaService.upscaleImage(body.imageUrl, { orgId: org.id, scale: body.scale }) };
  }

  @Post('/image-to-image')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async imageToImage(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ImageToImageDto
  ) {
    try {
      return { url: await this._aiDefaults.imageToImage(org.id, body.prompt, body.imageUrl) };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/upscale-video')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async upscaleVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpscaleVideoDto
  ) {
    try {
      const result = await this._aiDefaults.videoUpscale(org.id, body.videoUrl);
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/remove-video-background')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async removeVideoBackground(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RemoveVideoBackgroundDto
  ) {
    try {
      const result = await this._aiDefaults.videoBackground(org.id, body.videoUrl, { model: body.model });
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/video-to-video')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async videoToVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoToVideoDto
  ) {
    try {
      const result = await this._aiDefaults.videoToVideo(org.id, body.prompt, body.videoUrl);
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  /**
   * Trim-aware video-to-video: extracts [trimStartMs, trimEndMs] from the
   * source (re-encoding ffmpeg trim), stores the segment in tenant storage and
   * runs the standard video-to-video flow on it. Same billing policy, budget
   * ledger entry and job lifecycle as /media/video-to-video — the response is
   * the same { id, status: 'pending' } pair polled via GET /media/jobs/:id.
   */
  @Post('/video-segment-transform')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async videoSegmentTransform(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoSegmentTransformDto
  ) {
    try {
      const result = await this._videoSegmentTransform.transformSegment(org.id, body);
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/generate-music')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async generateMusic(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GenerateMusicDto
  ) {
    try {
      const result = await this._aiDefaults.textToMusic(org.id, body.prompt);
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/generate-avatar')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async generateAvatar(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GenerateAvatarDto
  ) {
    try {
      const result = await this._aiDefaults.videoAvatar(org.id, body.script, { imageUrl: body.imageUrl });
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/generate-slide')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async generateSlide(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GenerateSlideDto
  ) {
    try {
      // Images-only slideshow: the LLM slide breakdown needs a topic, so
      // substitute a default one — the supplied images ride along as the
      // reference imagery for the generated frames.
      const prompt =
        body.prompt?.trim() ||
        (body.imageUrls?.length
          ? 'A short slideshow showcasing the provided images.'
          : '');
      if (!prompt) {
        throw new BadRequestException('A prompt or at least one image is required');
      }
      const result = await this._aiDefaults.imageSlide(org.id, prompt, body.imageUrls, {
        fitMode: body.fitMode,
        aspect: body.aspect,
        width: body.width,
        height: body.height,
      });
      return { id: result, status: 'pending' };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/stock/download')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async triggerStockDownload(
    @GetOrgFromRequest() org: Organization,
    @Body('downloadLocation') downloadLocation: string
  ) {
    await this._stockMediaService.triggerDownload(downloadLocation);
    return { success: true };
  }

  @Get('/fonts')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  async listFonts(@GetOrgFromRequest() org: Organization) {
    return this._brandsService.getCustomFonts(org.id);
  }

  @Post('/fonts/upload')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadFont(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this._aiMediaService.uploadFont(org.id, file);
  }

  @Delete('/fonts/:fileId')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async deleteFont(
    @GetOrgFromRequest() org: Organization,
    @Param('fileId') fileId: string
  ) {
    return this._brandsService.removeCustomFont(org.id, fileId);
  }

  @Get('/voices')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async listVoices(
    @GetOrgFromRequest() org: Organization,
    @Query('provider') provider?: string,
  ) {
    return this._aiMediaService.listVoicesCached(org.id, provider);
  }

  @Post('/text-to-speech')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async textToSpeech(
    @GetOrgFromRequest() org: Organization,
    @Body('text') text: string,
    @Body('voice') voice?: string,
    @Body('instructions') instructions?: string,
    @Body('provider') provider?: string,
  ) {
    if (!text?.trim()) {
      throw new BadRequestException('Text is required');
    }
    return this._aiMediaService.textToSpeechAndSave(text, { orgId: org.id, voice, instructions, provider });
  }

  /**
   * Short spoken voiceover script for a topic, written by the org's
   * low-reasoning default — the Voiceover dialog's "Write script with AI"
   * button. The result lands in the dialog's textarea for the user to edit
   * before the (separately billed) TTS call.
   */
  @Post('/voiceover-script')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async voiceoverScript(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VoiceoverScriptDto,
  ) {
    try {
      const script = await this._aiDefaults.lowReasoningText(
        org.id,
        `Write a short voiceover script (2-4 spoken sentences, no headings, no stage directions, plain words meant to be read aloud) about: ${body.topic}`
      );
      return { script: script.trim() };
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException({ error: err.message, category: err.category }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  @Post('/speech-to-text')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async speechToText(
    @GetOrgFromRequest() org: Organization,
    @Body('audioUrl') audioUrl: string,
  ) {
    if (!audioUrl?.trim()) {
      throw new BadRequestException('audioUrl is required');
    }
    const res = await safeFetch(audioUrl);
    if (!res.ok) {
      throw new HttpException('Could not fetch audio for transcription', 400);
    }
    const arrayBuffer = await res.arrayBuffer();
    const text = await this._aiMediaService.speechToText(Buffer.from(arrayBuffer), { orgId: org.id });
    return { text };
  }

  @Post('/speech-to-text-words')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async speechToTextWords(
    @GetOrgFromRequest() org: Organization,
    @Body('audioUrl') audioUrl: string,
  ) {
    if (!audioUrl?.trim()) {
      throw new BadRequestException('audioUrl is required');
    }
    const res = await safeFetch(audioUrl);
    if (!res.ok) {
      throw new HttpException('Could not fetch audio for transcription', 400);
    }
    const arrayBuffer = await res.arrayBuffer();
    return this._aiMediaService.speechToTextWords(Buffer.from(arrayBuffer), { orgId: org.id });
  }

  @Post('/detect-focal-point')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async detectFocalPoint(
    @GetOrgFromRequest() org: Organization,
    @Body() body: DetectFocalPointDto,
  ) {
    return this._aiMediaService.detectFocalPoint(body.imageUrl, { orgId: org.id });
  }
}
