import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { AiDesignerService } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.service';
import { toAiDesignerSessionDto } from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';
import { Organization, User } from '@prisma/client';

@ApiTags('AI Designer')
@Controller('/ai-designer')
export class AiDesignerController {
  constructor(private readonly _service: AiDesignerService) {}

  @Get('/sessions')
  @RequirePermission('media', 'create')
  async listSessions(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const { sessions, total } = await this._service.listSessions(
      org.id,
      user.id,
      {
        page: this._positiveInt(page, 1),
        limit: Math.min(this._positiveInt(limit, 20), 100),
      }
    );
    return { sessions: sessions.map((s) => toAiDesignerSessionDto(s)), total };
  }

  private _positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  @Get('/sessions/:id')
  @RequirePermission('media', 'create')
  async getSession(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    const session = await this._service.getSessionForUser(id, org.id, user.id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const messages = await this._service.getMessages(session.id);
    return {
      session: toAiDesignerSessionDto(session),
      messages,
    };
  }

  @Delete('/sessions/:id')
  @RequirePermission('media', 'create')
  async deleteSession(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    const session = await this._service.getSessionForUser(id, org.id, user.id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    await this._service.deleteSession(id, org.id, user.id);
    return { deleted: true };
  }
}
