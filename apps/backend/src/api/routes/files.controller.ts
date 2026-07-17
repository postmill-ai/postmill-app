import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { StockMediaService, CONTENT_PACK_CAPABILITY_MAP } from '@gitroom/nestjs-libraries/media/stock/stock-media.service';
import { ContentPackDailyCapError } from '@gitroom/nestjs-libraries/media/stock/content-packs/content-pack.interface';
import { ImportFromUrlDto } from '@gitroom/nestjs-libraries/dtos/file/import.from.url.dto';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/file/save.media.information.dto';
import { CreateFolderDto } from '@gitroom/nestjs-libraries/dtos/file/create.folder.dto';
import { UpdateFolderDto } from '@gitroom/nestjs-libraries/dtos/file/update.folder.dto';
import { MoveMediaDto } from '@gitroom/nestjs-libraries/dtos/file/move.media.dto';
import { RenameMediaDto } from '@gitroom/nestjs-libraries/dtos/file/rename.media.dto';
import { UpdateMediaTagsDto } from '@gitroom/nestjs-libraries/dtos/file/update.media.tags.dto';
import { UpdateMediaDescriptionDto } from '@gitroom/nestjs-libraries/dtos/file/update.media.description.dto';
import { BulkDeleteMediaDto } from '@gitroom/nestjs-libraries/dtos/file/bulk.delete.media.dto';
import { BulkMoveMediaDto } from '@gitroom/nestjs-libraries/dtos/file/bulk.move.media.dto';
import { BulkSaveMediaDto } from '@gitroom/nestjs-libraries/dtos/file/bulk.save.media.dto';
import { GetFilesQueryDto } from '@gitroom/nestjs-libraries/dtos/file/get.files.query.dto';
import { SaveMediaDto } from '@gitroom/nestjs-libraries/dtos/file/save.media.dto';
import { UploadServerBodyDto } from '@gitroom/nestjs-libraries/dtos/file/upload.server.dto';
import { UploadSimpleBodyDto } from '@gitroom/nestjs-libraries/dtos/file/upload.simple.dto';
import { SearchFilesQueryDto } from '@gitroom/nestjs-libraries/dtos/file/search.files.query.dto';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { mkdirSync } from 'fs';
import fs from 'fs';
import * as path from 'path';
import { UPLOAD_LIMITS } from '@gitroom/nestjs-libraries/upload/upload-limits';

const TMP_UPLOAD_DIR = path.join(tmpdir(), 'postmill-uploads');
try { mkdirSync(TMP_UPLOAD_DIR, { recursive: true }); } catch {}

@ApiTags('Files')
@Controller('/files')
export class FilesController {
  private readonly _logger = new Logger(FilesController.name);

  constructor(
    private _fileService: FileService,
    private _storageService: StorageService,
    private _stockMediaService: StockMediaService,
    private _resolution: ProviderResolutionService
  ) {}

  // ── File CRUD ────────────────────────────────────────────

  @Get('/')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getFiles(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetFilesQueryDto
  ) {
    return this._fileService.getFiles(
      org.id,
      query.page,
      query.search,
      query.folderId,
      query.type,
      query.tag,
      query.sort,
      query.order,
      query.limit
    );
  }

  @Post('/upload-server')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.MEDIA],
    [AuthorizationActions.Create, Sections.STORAGE]
  )
  @RequirePermission('media', 'create')
  @UseInterceptors(FileInterceptor('file', {
      storage: diskStorage({
          destination: TMP_UPLOAD_DIR,
      }),
      limits: { fileSize: UPLOAD_LIMITS.maxBytes }
  }))
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadServerBodyDto
  ) {
    const folderId = body.folderId;
    try {
      const { adapter, configId } = await this._storageService.resolveAdapterForFolderWithConfigId(folderId, org.id);
      await this._storageService.assertWithinProviderQuota(adapter, org.id, file?.size || 0, configId);
      const originalName = file?.originalname || '';
      const uploadedFile = await adapter.uploadFile(file);
      try {
        return await this._fileService.saveFile(
          org.id,
          uploadedFile.originalname,
          uploadedFile.path,
          originalName,
          folderId,
          file?.size
        );
      } catch (err) {
        // M4: the object is already stored — on ANY post-write failure (402 quota,
        // folder-ownership 404, DB error) best-effort delete it so a failed upload
        // doesn't leak orphan bytes. A cleanup failure is logged, never rethrown —
        // the original error must surface.
        try {
          await adapter.removeFile(uploadedFile.path);
        } catch (cleanupErr) {
          this._logger.warn(
            `Failed to clean up stored object ${uploadedFile.path} after upload failure: ${(cleanupErr as Error).message}`
          );
        }
        throw err;
      }
    } finally {
      if (file?.path) { try { await fs.promises.unlink(file.path); } catch { /* best-effort */ } }
    }
  }

  @Post('/upload-simple')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.MEDIA],
    [AuthorizationActions.Create, Sections.STORAGE]
  )
  @RequirePermission('media', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.maxBytes } }))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body() body: UploadSimpleBodyDto
  ) {
    const folderId = body.folderId;
    const preventSave = body.preventSave ?? false;
    const { adapter, configId } = await this._storageService.resolveAdapterForFolderWithConfigId(folderId, org.id);
    await this._storageService.assertWithinProviderQuota(adapter, org.id, file?.size || 0, configId);
    const originalName = file.originalname;
    const getFile = await adapter.uploadFile(file);

    if (preventSave) {
      const { path } = getFile;
      return { path };
    }

    try {
      return await this._fileService.saveFile(
        org.id,
        getFile.originalname,
        getFile.path,
        originalName,
        folderId,
        file?.size
      );
    } catch (err) {
      // M4: same delete-on-failure as uploadServer — the stored object must not
      // leak when the post-write save fails. Cleanup failure is logged only.
      try {
        await adapter.removeFile(getFile.path);
      } catch (cleanupErr) {
        this._logger.warn(
          `Failed to clean up stored object ${getFile.path} after upload failure: ${(cleanupErr as Error).message}`
        );
      }
      throw err;
    }
  }

  @Post('/save-media')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.MEDIA],
    [AuthorizationActions.Create, Sections.STORAGE]
  )
  @RequirePermission('media', 'create')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaDto
  ) {
    if (!body.name) {
      return false;
    }
    const { fileSize } = await this._fileService.importFromPath(org.id, body.path, body.folderId);
    return this._fileService.saveFile(
      org.id,
      body.name,
      body.path,
      body.originalName || undefined,
      body.folderId,
      fileSize
    );
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async deleteFile(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._fileService.deleteFile(org.id, id);
    return { success: true };
  }

  @Post('/information')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._fileService.saveMediaInformation(org.id, body);
  }

  // ── Folder Endpoints ─────────────────────────────────────────

  @Get('/folders')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getFolderTree(@GetOrgFromRequest() org: Organization) {
    return this._fileService.getFolderTree(org.id);
  }

  @Get('/limits')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getUploadLimits() {
    return {
      maxBytes: UPLOAD_LIMITS.maxBytes,
      image: UPLOAD_LIMITS.image,
      video: UPLOAD_LIMITS.video,
      audio: UPLOAD_LIMITS.audio,
    };
  }

  @Post('/folders')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  createFolder(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateFolderDto
  ) {
    return this._fileService.createFolder(org.id, body);
  }

  @Put('/folders/:id')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  updateFolder(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateFolderDto
  ) {
    return this._fileService.updateFolder(org.id, id, body);
  }

  @Delete('/folders/:id')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  deleteFolder(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._fileService.deleteFolder(org.id, id);
  }

  // ── File Management ────────────────────────────────────

  @Put('/:id/move')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  moveFile(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: MoveMediaDto
  ) {
    return this._fileService.moveFile(org.id, id, body.folderId || null);
  }

  @Put('/:id/rename')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  renameFile(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: RenameMediaDto
  ) {
    return this._fileService.renameFile(org.id, id, body.name);
  }

  @Put('/:id/tags')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  updateFileTags(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateMediaTagsDto
  ) {
    return this._fileService.updateFileTags(org.id, id, body.tags);
  }

  @Put('/:id/description')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  updateFileDescription(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateMediaDescriptionDto
  ) {
    return this._fileService.updateFileDescription(org.id, id, body.description || '');
  }

  @Post('/bulk/delete')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  bulkDelete(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkDeleteMediaDto
  ) {
    return this._fileService.bulkDelete(org.id, body.ids);
  }

  @Post('/bulk/move')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async bulkMove(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkMoveMediaDto
  ) {
    // 1.2: the repository's bulkMove updateMany is NOT org-scoped, so restrict
    // the id set to files the caller's org actually owns before moving. Foreign
    // ids drop out here → they affect 0 rows.
    const owned = await this._fileService.getByIds(org.id, body.ids);
    const ownedIds = owned.map((f) => f.id);
    return this._fileService.bulkMove(org.id, ownedIds, body.folderId || null);
  }

  @Get('/search')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  searchFiles(
    @GetOrgFromRequest() org: Organization,
    @Query() query: SearchFilesQueryDto
  ) {
    return this._fileService.searchFiles(org.id, query.q, query.folderId);
  }

  @Get('/folder/:folderId')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getFilesByFolder(
    @GetOrgFromRequest() org: Organization,
    @Param('folderId') folderId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number
  ) {
    return this._fileService.getFilesByFolder(org.id, folderId, page);
  }

  @Get('/folder/:folderId/contents')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getFolderContents(
    @GetOrgFromRequest() org: Organization,
    @Param('folderId') folderId: string
  ) {
    // 1.1: this was the lone folder route missing an ownership check — validate
    // the folder belongs to the caller's org before disclosing its contents.
    await this._fileService.getFolder(org.id, folderId);
    return this._fileService.getFolderContents(org.id, folderId);
  }

  @Post('/bulk/save')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.MEDIA],
    [AuthorizationActions.Create, Sections.STORAGE]
  )
  @RequirePermission('media', 'create')
  async bulkSaveFiles(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkSaveMediaDto
  ) {
    const items = await Promise.all(
      body.items.map(async (item) => {
        const { fileSize } = await this._fileService.importFromPath(org.id, item.path, item.folderId);
        return { ...item, fileSize };
      })
    );
    return this._fileService.bulkSave(org.id, items);
  }

  @Post('/:id/trash')
  @CheckPolicies([AuthorizationActions.Delete, Sections.MEDIA])
  @RequirePermission('media', 'delete')
  async softDelete(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._fileService.softDelete(id, org.id);
    return { success: true };
  }

  @Post('/:id/restore')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  async restore(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._fileService.restore(id, org.id);
    return { success: true };
  }

  @Get('/trash')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async getTrash(@GetOrgFromRequest() org: Organization) {
    const trashed = await this._fileService.getTrashed(org.id);
    return trashed;
  }

  // ── Import from URL ────────────────────────────────────

  @Post('/import')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.MEDIA],
    [AuthorizationActions.Create, Sections.STORAGE]
  )
  @RequirePermission('media', 'create')
  async importFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ImportFromUrlDto
  ) {
    const contentPackIdentifiers = this._resolution
      .listManifests('contentpack')
      .map((m) => m.providerId);
    if (body.source && contentPackIdentifiers.includes(body.source) && body.downloadLocation) {
      const capability = CONTENT_PACK_CAPABILITY_MAP[(body.type || 'photos').toLowerCase()];
      if (!capability) {
        throw new HttpException(`Unsupported content pack type: ${body.type}`, 400);
      }
      try {
        const { url: licensedUrl } = await this._stockMediaService.importContentPackAsset(
          org.id,
          body.source,
          body.downloadLocation,
          body.type,
        );
        return this._fileService.importFromUrl(org.id, { ...body, url: licensedUrl });
      } catch (err) {
        if (err instanceof ContentPackDailyCapError) {
          throw new HttpException(err.message, 402);
        }
        if (
          err instanceof Error &&
          err.message.startsWith('Unsupported content pack type')
        ) {
          throw new HttpException(err.message, 400);
        }
        // 6.3: never leak the raw upstream provider body to the client — log the
        // detail server-side, return a generic message.
        this._logger.warn(
          `Content pack mint failed for "${body.source}": ${(err as Error).message}`
        );
        throw new HttpException('Could not retrieve the licensed asset', 502);
      }
    }

    const result = await this._fileService.importFromUrl(org.id, body);
    if (body.source === 'unsplash' && body.downloadLocation) {
      await this._stockMediaService.triggerDownload(body.downloadLocation);
    }
    return result;
  }
}
