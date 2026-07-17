import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { ApiTags } from '@nestjs/swagger';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { StockMediaService } from '@gitroom/nestjs-libraries/media/stock/stock-media.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { RemoveBackgroundDto } from '@gitroom/nestjs-libraries/dtos/ai/remove.background.dto';
import { DetectFocalPointDto } from '@gitroom/nestjs-libraries/dtos/ai/detect-focal-point.dto';
import { UpscaleImageDto } from '@gitroom/nestjs-libraries/dtos/ai/upscale.image.dto';
import { InpaintImageDto } from '@gitroom/nestjs-libraries/dtos/ai/inpaint.image.dto';
import { ImageToImageDto } from '@gitroom/nestjs-libraries/dtos/ai/image-to-image.dto';
import { UpscaleVideoDto } from '@gitroom/nestjs-libraries/dtos/ai/upscale-video.dto';
import { RemoveVideoBackgroundDto } from '@gitroom/nestjs-libraries/dtos/ai/remove-video-background.dto';
import { GenerateMusicDto } from '@gitroom/nestjs-libraries/dtos/ai/generate-music.dto';
import { VideoToVideoDto } from '@gitroom/nestjs-libraries/dtos/ai/video-to-video.dto';
import { GenerateAvatarDto } from '@gitroom/nestjs-libraries/dtos/ai/generate-avatar.dto';
import { GenerateSlideDto } from '@gitroom/nestjs-libraries/dtos/ai/generate-slide.dto';
import { GenerateVideoDto } from '@gitroom/backend/dtos/media/generate-video.dto';
import { VideoFunctionDto } from '@gitroom/backend/dtos/media/video-function.dto';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { BadRequestException } from '@nestjs/common';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { AiDefaultsService, DefaultNotConfiguredError } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { DefaultsResolutionService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { UseFilters } from '@nestjs/common';
import { MediaCapabilityFilter } from '@gitroom/backend/api/routes/media-capability.filter';

@ApiTags('Media')
@Controller('/media')
@UseFilters(MediaCapabilityFilter)
export class MediaController {
  constructor(
    private _aiDefaults: AiDefaultsService,
    private _aiMediaService: AiMediaService,
    private _defaultsResolution: DefaultsResolutionService,
    private _fileService: FileService,
    private _storageService: StorageService,
    private _stockMediaService: StockMediaService,
    private _brandsService: BrandsService
  ) {}

  @Post('/generate-video')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
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
    return {
      id: job.id,
      status: job.status,
      artifactUrl: job.artifactUrl,
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

  @Post('/video/function')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
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
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    try {
      let finalPrompt = prompt;
      if (isPicturePrompt) {
        finalPrompt = await this._aiDefaults.lowReasoningText(
          org.id,
          `Create a concise, vivid image-generation prompt from this idea: ${prompt}`
        );
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
      const result = await this._aiDefaults.videoBackground(org.id, body.videoUrl);
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

  @Post('/generate-music')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
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
  async generateSlide(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GenerateSlideDto
  ) {
    try {
      const result = await this._aiDefaults.imageSlide(org.id, body.prompt, body.imageUrls);
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
  ) {
    if (!text?.trim()) {
      throw new BadRequestException('Text is required');
    }
    return this._aiMediaService.textToSpeechAndSave(text, { orgId: org.id, voice });
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
