import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';

@ApiTags('Signatures')
@Controller('/signatures')
export class SignatureController {
  constructor(private _signatureService: SignatureService) {}

  @Get('/')
  async getSignatures(@GetOrgFromRequest() org: Organization) {
    return this._signatureService.getSignaturesByOrgId(org.id);
  }

  @Get('/default')
  async getDefaultSignature(@GetOrgFromRequest() org: Organization) {
    return (await this._signatureService.getDefaultSignature(org.id)) || {};
  }

  @Get('/auto')
  async getAutoAddSignatures(@GetOrgFromRequest() org: Organization) {
    return this._signatureService.getAutoAddSignatures(org.id);
  }

  @Post('/:id/track-usage')
  async trackUsage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    await this._signatureService.trackUsage(org.id, id);
    return { success: true };
  }

  @Post('/')
  async createSignature(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SignatureDto
  ) {
    return this._signatureService.createOrUpdateSignature(org.id, body);
  }

  @Delete('/:id')
  async deleteSignature(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._signatureService.deleteSignature(org.id, id);
  }

  @Put('/:id')
  async updateSignature(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: SignatureDto
  ) {
    return this._signatureService.createOrUpdateSignature(org.id, body, id);
  }
}
