import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { NotificationCategory } from '@gitroom/nestjs-libraries/dtos/notifications/notification-preference.dto';

export interface DigestItem {
  title: string;
  message: string;
  html?: string;
  category: NotificationCategory;
}

@Injectable()
export class NotificationDigestService {
  constructor(
    private _digestQueue: PrismaRepository<'notificationDigestQueue'>
  ) {}

  async enqueue(
    userId: string,
    organizationId: string,
    item: DigestItem
  ): Promise<void> {
    await this._digestQueue.model.notificationDigestQueue.create({
      data: {
        userId,
        organizationId,
        title: item.title,
        message: item.message,
        html: item.html ?? null,
        category: item.category,
      },
    });
  }

  async enqueueMany(
    userIds: string[],
    organizationId: string,
    item: DigestItem
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this._digestQueue.model.notificationDigestQueue.createMany({
      data: userIds.map((userId) => ({
        userId,
        organizationId,
        title: item.title,
        message: item.message,
        html: item.html ?? null,
        category: item.category,
      })),
    });
  }

  async getPendingForUser(userId: string, organizationId: string) {
    return this._digestQueue.model.notificationDigestQueue.findMany({
      where: { userId, organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPendingForUsers(userIds: string[]) {
    if (userIds.length === 0) return [];
    return this._digestQueue.model.notificationDigestQueue.findMany({
      where: { userId: { in: userIds } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getOrganizationIdsForUser(userId: string): Promise<string[]> {
    const rows = await this._digestQueue.model.notificationDigestQueue.findMany({
      where: { userId },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
    return rows.map((row) => row.organizationId);
  }

  async deleteForUser(userId: string, organizationId: string): Promise<void> {
    await this._digestQueue.model.notificationDigestQueue.deleteMany({
      where: { userId, organizationId },
    });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this._digestQueue.model.notificationDigestQueue.deleteMany({
      where: { id: { in: ids } },
    });
  }
}
