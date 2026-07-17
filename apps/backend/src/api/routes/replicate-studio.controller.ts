import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { ReplicateRunnerService } from '@gitroom/nestjs-libraries/media/replicate-studio/replicate-runner.service';
import { ReplicateCatalogService } from '@gitroom/nestjs-libraries/media/replicate-studio/replicate-catalog.service';
import { ReplicateEnhanceService } from '@gitroom/nestjs-libraries/media/replicate-studio/replicate-enhance.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { EstimateDto, RunSyncDto, RunAsyncDto, SaveUrlDto, MergeDto, EnhancePromptDto } from '@gitroom/nestjs-libraries/dtos/replicate';
import { estimate } from '@gitroom/nestjs-libraries/media/replicate-studio/replicate-cost';

@ApiTags('Replicate Studio')
@Controller('/media/replicate')
export class ReplicateStudioController {
  constructor(
    private readonly _runner: ReplicateRunnerService,
    private readonly _catalog: ReplicateCatalogService,
    private readonly _enhance: ReplicateEnhanceService,
    private readonly _fileService: FileService,
  ) {}

  @Get('/status')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getStatus(@GetOrgFromRequest() org: Organization) {
    try {
      await this._catalog.getReplicateKey(org.id);
      return { configured: true };
    } catch {
      return { configured: false };
    }
  }

  @Get('/categories')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getCategories() {
    return this._catalog.getCategories();
  }

  @Get('/categories/:category/models')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getModels(
    @Param('category') category: string,
    @GetOrgFromRequest() org: Organization,
  ) {
    return this._catalog.listModels(category, org.id);
  }

  @Get('/models/:owner/:name')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getModel(
    @Param('owner') owner: string,
    @Param('name') name: string,
    @GetOrgFromRequest() org: Organization,
  ) {
    return this._catalog.getModel(owner, name, org.id);
  }

  @Post('/estimate')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async estimate(
    @Body() body: EstimateDto,
  ) {
    return estimate(body.modelId, body.input);
  }

  @Post('/run/sync')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async runSync(
    @Body() body: RunSyncDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    if (body.operation === 'image') {
      return this._runner.runSync(org.id, user.id, {
        modelId: body.modelId,
        input: body.input,
        operation: body.operation,
      });
    }

    // STT: no credit gate, no credit consumption
    return this._runner.runSync(org.id, user.id, {
      modelId: body.modelId,
      input: body.input,
      operation: body.operation,
    });
  }

  @Post('/run/async')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async runAsync(
    @Body() body: RunAsyncDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    if (body.operation === 'video' || body.operation === 'image') {
      return this._runner.runAsync(org.id, user.id, {
        modelId: body.modelId,
        versionId: body.versionId,
        input: body.input,
        folderId: body.folderId,
        operation: body.operation,
      });
    }

    // Audio: no gate, no credit consumption
    return this._runner.runAsync(org.id, user.id, {
      modelId: body.modelId,
      versionId: body.versionId,
      input: body.input,
      folderId: body.folderId,
      operation: body.operation,
    });
  }

  @Get('/jobs/:id')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getJob(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
  ) {
    return this._runner.getJob(org.id, id);
  }

  @Post('/enhance-prompt')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async enhancePrompt(
    @Body() body: EnhancePromptDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._enhance.enhance(org.id, user.id, body.prompt, body.mode || 'positive');
  }

  @Post('/save-url')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  async saveUrl(
    @Body() body: SaveUrlDto,
    @GetOrgFromRequest() org: Organization,
  ) {
    return this._fileService.importFromUrl(org.id, {
      url: body.url,
      name: body.name,
      folderId: body.folderId,
    });
  }

  @Post('/merge')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async merge(
    @Body() body: MergeDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._runner.runMerge(org.id, user.id, {
      clips: body.clips,
      transitions: body.transitions,
      folderId: body.folderId,
    });
  }
}
