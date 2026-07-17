import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { IsString, IsOptional, IsBoolean, IsArray, IsObject } from 'class-validator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

class CreateBrandDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  platformInstructions?: Record<string, string>;

  // Per-language datasets: { [lang]: { instructions, overrides: { [channelId]: string } } }.
  @IsOptional()
  @IsObject()
  languageProfiles?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  logoFileIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  palette?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fontFamilies?: string[];

  // Attached brand assets — [{ fileId?, url, caption? }].
  @IsOptional()
  @IsArray()
  assets?: { fileId?: string; url: string; caption?: string }[];

  @IsOptional()
  @IsObject()
  enforcement?: Record<string, any>;
}

class UpdateBrandDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  platformInstructions?: Record<string, string>;

  // Per-language datasets: { [lang]: { instructions, overrides: { [channelId]: string } } }.
  @IsOptional()
  @IsObject()
  languageProfiles?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  logoFileIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  palette?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fontFamilies?: string[];

  @IsOptional()
  @IsString()
  introFileId?: string;

  @IsOptional()
  @IsString()
  outroFileId?: string;

  // Attached brand assets — [{ fileId?, url, caption? }].
  @IsOptional()
  @IsArray()
  assets?: { fileId?: string; url: string; caption?: string }[];

  @IsOptional()
  @IsObject()
  enforcement?: Record<string, any>;
}

@ApiTags('Brands')
@Controller('/brands')
@UseGuards(OrgRbacGuard)
export class BrandsController {
  constructor(private _brandsService: BrandsService) {}

  @Get('/')
  @RequirePermission('brands', 'read')
  @CheckPolicies([AuthorizationActions.Read, Sections.BRANDS])
  async list(@GetOrgFromRequest() org: Organization) {
    return this._brandsService.getBrands(org.id);
  }

  @Post('/')
  @RequirePermission('brands', 'manage')
  @CheckPolicies([AuthorizationActions.Create, Sections.BRANDS])
  async create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateBrandDto,
  ) {
    return this._brandsService.createBrand(org.id, body);
  }

  @Put('/:id')
  @RequirePermission('brands', 'manage')
  @CheckPolicies([AuthorizationActions.Update, Sections.BRANDS])
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateBrandDto,
  ) {
    const result = await this._brandsService.updateBrand(org.id, id, body);
    if (!result) {
      throw new HttpException('Brand not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Delete('/:id')
  @RequirePermission('brands', 'manage')
  @CheckPolicies([AuthorizationActions.Delete, Sections.BRANDS])
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    const result = await this._brandsService.deleteBrand(org.id, id);
    if (!result) {
      throw new HttpException('Brand not found', HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }

  @Post('/:id/default')
  @RequirePermission('brands', 'manage')
  @CheckPolicies([AuthorizationActions.Update, Sections.BRANDS])
  async setDefault(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    const result = await this._brandsService.setDefaultBrand(org.id, id);
    if (!result) {
      throw new HttpException('Brand not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }
}
