import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DesignShareService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design-share.service';
import {
  ApproveDesignShareDto,
  CreateDesignShareCommentDto,
} from '@postmill-ai/nestjs-libraries/dtos/design/design-share.dto';

@ApiTags('Public design sharing')
@Controller('/public/design-share')
export class PublicDesignShareController {
  constructor(private readonly _shareService: DesignShareService) {}

  @Get('/:token')
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  getPublicPreview(@Param('token') token: string) {
    return this._shareService.getPublicPreview(token);
  }

  @Get('/:token/preview/:outputIndex/:pageNumber')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async renderPublicPreview(
    @Param('token') token: string,
    @Param('outputIndex', ParseIntPipe) outputIndex: number,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Res() res: Response,
  ): Promise<void> {
    const png = await this._shareService.renderPublicPreview(token, outputIndex, pageNumber);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(png);
  }

  @Post('/:token/comments')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  addComment(@Param('token') token: string, @Body() body: CreateDesignShareCommentDto) {
    return this._shareService.addComment(token, body.name, body.content);
  }

  @Post('/:token/approve')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  approve(@Param('token') token: string, @Body() body: ApproveDesignShareDto) {
    return this._shareService.approve(token, body.name);
  }
}
