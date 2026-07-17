import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  HttpException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';
import { DefaultsSeedService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-seed.service';

// PROVIDER_REMEDIATION 3.2: this endpoint iterates ALL orgs, so it is
// platform-operator-only. The class-level SuperAdminGuard is the structural backstop;
// the handler also keeps its explicit `isSuperAdmin` check (defense in depth).
@ApiTags('Admin Defaults')
@Controller('/admin/defaults')
@UseGuards(SuperAdminGuard, OrgRbacGuard)
export class AdminDefaultsController {
  constructor(private _defaultsSeed: DefaultsSeedService) {}

  @Post('/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  async backfill(@GetUserFromRequest() user: User) {
    // This endpoint is intentionally org-agnostic: it iterates ALL orgs and seeds
    // any unset AI/media default model rows from their enabled providers. Because
    // it crosses org boundaries it must be platform-operator-only — gate on
    // `User.isSuperAdmin` (the verified super-admin pattern used by
    // AnnouncementsController / StorageController / UsersController). RBAC's
    // `settings:update` is org-scoped and would let any org admin trigger an
    // all-orgs backfill, so it is intentionally NOT used here.
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    // Run DETACHED and return 202 immediately. Seeding every org's defaults makes one
    // provider `listModels` call per unset category per org, so awaiting it inline would
    // block this request for minutes and risk an HTTP/proxy timeout (the @HttpCode(202)
    // already signals async processing). The work is idempotent and re-runnable, and
    // `seedAllOrgs()` logs per-org failures, so fire-and-forget is safe here. The boot-time
    // `BackfillService` step also covers existing orgs on deploy.
    this._defaultsSeed.seedAllOrgs().catch(() => undefined);
    return { success: true, status: 'accepted' };
  }
}
