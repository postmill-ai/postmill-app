import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { NotificationCategory } from '@gitroom/nestjs-libraries/dtos/notifications/notification-preference.dto';

export interface CreateNotificationInput {
  organizationId: string;
  type: NotificationCategory;
  title?: string;
  content: string;
  link?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    private _notifications: PrismaRepository<'notifications'>,
    private _notificationRead: PrismaRepository<'notificationRead'>,
    private _user: PrismaRepository<'user'>
  ) {}

  async createNotification(input: CreateNotificationInput) {
    return this._notifications.model.notifications.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        title: input.title ?? null,
        content: input.content,
        link: input.link ?? null,
        metadata: input.metadata ?? null,
      },
    });
  }

  async createReadRecords(notificationId: string, userIds: string[]) {
    if (userIds.length === 0) return;

    const existing = await this._notificationRead.model.notificationRead.findMany({
      where: { notificationId, userId: { in: userIds } },
      select: { userId: true },
    });

    const existingSet = new Set(existing.map((r) => r.userId));
    const missing = userIds.filter((id) => !existingSet.has(id));

    if (missing.length === 0) return;

    await this._notificationRead.model.notificationRead.createMany({
      data: missing.map((userId) => ({
        notificationId,
        userId,
        readAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  async getUnreadCount(organizationId: string, userId: string) {
    return this._notifications.model.notifications.count({
      where: {
        organizationId,
        deletedAt: null,
        reads: {
          none: {
            userId,
          },
        },
      },
    });
  }

  async getNotificationsPaginated(
    organizationId: string,
    userId: string,
    page: number
  ) {
    const limit = 100;
    const skip = page * limit;

    const where = {
      organizationId,
      deletedAt: null as Date | null,
    };

    const [notifications, total] = await Promise.all([
      this._notifications.model.notifications.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          content: true,
          link: true,
          metadata: true,
          createdAt: true,
          reads: {
            where: { userId },
            select: { readAt: true },
            take: 1,
          },
        },
      }),
      this._notifications.model.notifications.count({ where }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        ...n,
        readAt: n.reads[0]?.readAt ?? null,
        reads: undefined,
      })),
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    };
  }

  async getNotifications(organizationId: string, userId: string) {
    const notifications = await this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        link: true,
        metadata: true,
        createdAt: true,
        reads: {
          where: { userId },
          select: { readAt: true },
          take: 1,
        },
      },
    });

    return {
      notifications: notifications.map((n) => ({
        ...n,
        readAt: n.reads[0]?.readAt ?? null,
        reads: undefined,
      })),
    };
  }

  async markAsRead(
    notificationId: string,
    userId: string,
    organizationId: string
  ) {
    // Only mark read a notification that belongs to the caller's org.
    const owned = await this._notifications.model.notifications.findFirst({
      where: { id: notificationId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) return;

    await this._notificationRead.model.notificationRead.upsert({
      where: {
        notificationId_userId: {
          notificationId,
          userId,
        },
      },
      create: {
        notificationId,
        userId,
        readAt: new Date(),
      },
      update: {
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(organizationId: string, userId: string) {
    const unread = await this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        deletedAt: null,
        reads: {
          none: {
            userId,
          },
        },
      },
      select: { id: true },
    });

    if (unread.length === 0) return;

    await this._notificationRead.model.notificationRead.createMany({
      data: unread.map((n) => ({
        notificationId: n.id,
        userId,
        readAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  async deleteNotification(id: string, organizationId: string) {
    // Org-scoped soft delete — updateMany so a cross-org id is a no-op, not an IDOR.
    await this._notifications.model.notifications.updateMany({
      where: { id, organizationId },
      data: { deletedAt: new Date() },
    });
  }
}
