import {
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import {
  DashboardService,
  DashboardSummaryResponse,
  AttentionKind,
  PlanUsageSnapshot,
} from '@gitroom/nestjs-libraries/dashboard/dashboard.service';
import { DashboardBriefService } from '@gitroom/nestjs-libraries/dashboard/dashboard-brief.service';
import { Organization, User } from '@prisma/client';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { RolesService } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.service';

const KIND_PERMISSION_MAP: Record<AttentionKind, string> = {
  'failed-posts': 'posts:read',
  'channel-health': 'posts:read',
  'pending-approvals': 'posts:update',
  'unread-comments': 'comments:read',
  'schedule-gaps': 'posts:read',
  budget: 'billing:read',
  'failed-media-jobs': 'media:read',
  anomalies: 'analytics:read',
};

@Controller('/dashboard')
export class DashboardController {
  constructor(
    private _dashboardService: DashboardService,
    private _permissionsService: PermissionsService,
    private _rolesService: RolesService,
    private _briefService: DashboardBriefService,
  ) {}

  @Get('/summary')
  async getSummary(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ): Promise<DashboardSummaryResponse> {
    if (!org?.id) {
      throw new UnauthorizedException();
    }

    return this._dashboardService.getSummary(org, user);
  }

  @Get('/schedule')
  @RequirePermission('posts', 'read')
  async getSchedule(
    @GetOrgFromRequest() org: Organization,
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
    @Query('timezone') timezone?: string,
  ) {
    if (!org?.id) {
      throw new UnauthorizedException();
    }

    return this._dashboardService.getSchedule(
      org.id,
      Math.min(Math.max(days, 1), 30),
      timezone || 'UTC',
    );
  }

  @Get('/campaigns')
  @RequirePermission('posts', 'read')
  async getCampaigns(
    @GetOrgFromRequest() org: Organization,
    @Query('limit', new DefaultValuePipe(6), ParseIntPipe) limit: number,
  ) {
    if (!org?.id) {
      throw new UnauthorizedException();
    }

    return this._dashboardService.getCampaignSummaries(
      org.id,
      Math.min(Math.max(limit, 1), 50),
    );
  }

  @Get('/media-jobs')
  @RequirePermission('media', 'read')
  async getMediaJobs(@GetOrgFromRequest() org: Organization) {
    if (!org?.id) {
      throw new UnauthorizedException();
    }

    return this._dashboardService.getMediaJobs(org.id);
  }

  @Get('/usage')
  @RequirePermission('billing', 'read')
  async getUsage(@GetOrgFromRequest() org: Organization) {
    if (!org?.id) {
      throw new UnauthorizedException();
    }

    const billingEnabled = !!process.env.STRIPE_PUBLISHABLE_KEY;
    if (!billingEnabled) {
      return { billingEnabled: false };
    }

    const { subscription, options, byoStorageActive } =
      await this._permissionsService.getEffectiveLimits(org.id);

    return this._dashboardService.buildUsage(
      org,
      subscription,
      options,
      byoStorageActive
    );
  }

  @Get('/attention')
  async getAttention(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    if (!org?.id || !user?.id) {
      throw new UnauthorizedException();
    }

    const effective = await this._rolesService.getEffectivePermissions(
      org.id,
      user.id,
    );
    const permissions = new Set(effective?.permissions ?? []);
    const permittedKinds = (Object.keys(KIND_PERMISSION_MAP) as AttentionKind[]).filter(
      (kind) => permissions.has(KIND_PERMISSION_MAP[kind]),
    );

    let planUsage: PlanUsageSnapshot | undefined;
    if (permissions.has('billing:read')) {
      const { subscription, options } =
        await this._permissionsService.getPackageOptions(org.id);
      planUsage = await this._dashboardService.buildPlanUsage(org, subscription, options);
    }

    const timezone = (user as any).profile?.timezone;

    return this._dashboardService.getAttention(
      org.id,
      user.id,
      permittedKinds,
      planUsage,
      timezone,
    );
  }

  @Get('/brief')
  @RequirePermission('analytics', 'read')
  async getBrief(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    if (!org?.id || !user?.id) {
      throw new UnauthorizedException();
    }
    return this._briefService.getCachedBrief(org, user);
  }

  @Post('/brief')
  @RequirePermission('analytics', 'read')
  async generateBrief(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    if (!org?.id || !user?.id) {
      throw new UnauthorizedException();
    }

    const effective = await this._rolesService.getEffectivePermissions(
      org.id,
      user.id,
    );
    const permissions = new Set(effective?.permissions ?? []);
    const permittedKinds = (Object.keys(KIND_PERMISSION_MAP) as AttentionKind[]).filter(
      (kind) => permissions.has(KIND_PERMISSION_MAP[kind]),
    );

    let planUsage: PlanUsageSnapshot | undefined;
    if (permissions.has('billing:read')) {
      const { subscription, options } =
        await this._permissionsService.getPackageOptions(org.id);
      planUsage = await this._dashboardService.buildPlanUsage(org, subscription, options);
    }

    return this._briefService.generateBrief(org, user, permittedKinds, planUsage);
  }
}
