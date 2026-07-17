import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { BroadcastNotificationDto } from '@gitroom/nestjs-libraries/dtos/notifications/notification-preference.dto';

// PROVIDER_REMEDIATION 3.2 audit: this controller is intentionally NOT super-admin
// gated. Per the plan's Phase-0 audit it is org-scoped by construction — the
// broadcast reads getTeam(org.id), intersects targets to the caller's own members
// and notify()s with the caller's orgId, so it cannot touch another tenant. An org
// admin announcing to their own team (RBAC notifications:manage) is intended.
@ApiTags('Admin Notifications')
@Controller('/admin/notifications')
@UseGuards(OrgRbacGuard)
export class AdminNotificationsController {
  constructor(private _notificationService: NotificationService) {}

  @Post('/broadcast')
  @RequirePermission('notifications', 'manage')
  async broadcast(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body() body: BroadcastNotificationDto
  ) {
    return this._notificationService.broadcast(organization.id, body);
  }
}
