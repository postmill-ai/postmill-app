import {
  Body,
  Controller,
  HttpException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { SubscriptionService } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { LimitOverridesDto } from '@postmill-ai/nestjs-libraries/dtos/billing/limit-overrides.dto';
import { SuperAdminGuard } from '@postmill-ai/backend/services/auth/rbac/super-admin.guard';

@ApiTags('Admin Orgs')
@Controller('/admin/orgs')
// SuperAdminGuard is the class-level structural backstop (same pattern as
// AdminProvidersController). This controller is registered in the
// `authenticatedController` array in api.module.ts — without that it would
// serve unauthenticated. The separate admin app calls it with the super-admin
// JWT in the custom `auth` header (CSRF is skipped for header auth).
@UseGuards(SuperAdminGuard)
export class AdminOrgsController {
  constructor(
    private readonly _subscriptionService: SubscriptionService
  ) {}

  private _assertSuperAdmin(user: User) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 403);
    }
  }

  // Manual numeric-limit overrides, backend-only. Body: { overrides: { key:
  // number | null } } — a number sets, null clears, absent leaves. Boolean
  // features and analytics_retention_days are rejected by the DTO/service.
  @Patch('/:orgId/limit-overrides')
  setLimitOverrides(
    @GetUserFromRequest() user: User,
    @Param('orgId') orgId: string,
    @Body() body: LimitOverridesDto
  ) {
    this._assertSuperAdmin(user);
    return this._subscriptionService.setLimitOverrides(
      orgId,
      body.overrides as Record<string, number | null>
    );
  }
}
