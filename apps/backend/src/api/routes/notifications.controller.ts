import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { NotificationPreferenceService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { PushNotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/push-notification.service';
import { ApiTags } from '@nestjs/swagger';
import {
  RegisterPushTokenDto,
  UpdateNotificationPreferenceDto,
} from '@postmill-ai/nestjs-libraries/dtos/notifications/notification-preference.dto';
import { GetNotificationsDto } from '@postmill-ai/nestjs-libraries/dtos/notifications/get.notifications.dto';
import { OrgRbacGuard } from '@postmill-ai/backend/services/auth/rbac/org-rbac.guard';

@ApiTags('Notifications')
@Controller('/notifications')
@UseGuards(OrgRbacGuard)
export class NotificationsController {
  constructor(
    private _notificationsService: NotificationService,
    private _preferenceService: NotificationPreferenceService,
    private _pushService: PushNotificationService
  ) {}

  @Get('/')
  // The header bell polls the unread count every 30s and on every window focus; a long
  // session with a lot of tab switching overruns the global 600/h backstop.
  @Throttle({ default: { limit: 2000, ttl: 3600000 } })
  async mainPageList(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    const total = await this._notificationsService.getMainPageCount(
      organization.id,
      user.id
    );
    return { total };
  }

  @Get('/list')
  // The open notification panel refreshes every 30s; same headroom as the count above.
  @Throttle({ default: { limit: 2000, ttl: 3600000 } })
  async notifications(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Query() query: GetNotificationsDto
  ) {
    if (query.page !== undefined && query.page > 0) {
      return this._notificationsService.getNotificationsPaginated(
        organization.id,
        user.id,
        query.page
      );
    }
    return this._notificationsService.getNotifications(
      organization.id,
      user.id
    );
  }

  @Patch('/:id/read')
  async markAsRead(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    await this._notificationsService.markAsRead(id, user.id, organization.id);
    return { success: true };
  }

  @Post('/read-all')
  async markAllAsRead(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    await this._notificationsService.markAllAsRead(organization.id, user.id);
    return { success: true };
  }

  @Delete('/:id')
  async deleteNotification(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    await this._notificationsService.deleteNotification(id, organization.id);
    return { success: true };
  }

  @Get('/preferences')
  async getPreferences(@GetUserFromRequest() user: User) {
    return this._preferenceService.getPreferences(user.id);
  }

  // Strip unknown category keys instead of 400-ing on them: during a deploy a
  // stale frontend may POST the previous category set (or a future one). The
  // service only merges known keys, so silently dropping extras is safe and
  // avoids breaking preference saves across a version skew.
  @Post('/preferences')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    })
  )
  async updatePreferences(
    @GetUserFromRequest() user: User,
    @Body() body: UpdateNotificationPreferenceDto
  ) {
    return this._preferenceService.updatePreferences(user.id, body);
  }

  @Post('/push-tokens')
  async registerPushToken(
    @GetUserFromRequest() user: User,
    @Body() body: RegisterPushTokenDto
  ) {
    await this._pushService.registerToken(
      user.id,
      body.token,
      body.platform,
      body.deviceName
    );
    return { success: true };
  }
}
