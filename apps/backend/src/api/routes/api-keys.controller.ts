import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import { IsString, IsOptional, IsISO8601, MinLength, MaxLength } from 'class-validator';
import { Request } from 'express';

class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

class RotateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

@ApiTags('API Keys')
@Controller('/user/api-keys')
export class ApiKeysController {
  constructor(private apiKeysService: ApiKeysService) {}

  @Get('/')
  async listKeys(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
  ) {
    const keys = await this.apiKeysService.listKeys(user.id, organization.id);
    return keys.map(({ hashedKey, ...rest }) => rest);
  }

  @Post('/')
  async createKey(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body() body: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createKey(user.id, organization.id, body.name, body.expiresAt);
  }

  @Post('/:id/rotate')
  async rotateKey(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: RotateApiKeyDto,
  ) {
    return this.apiKeysService.rotateKey(id, user.id, organization.id, body.name, body.expiresAt);
  }

  @Delete('/:id')
  async revokeKey(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
  ) {
    await this.apiKeysService.revokeKey(id, user.id, organization.id);
    return { success: true };
  }
}
