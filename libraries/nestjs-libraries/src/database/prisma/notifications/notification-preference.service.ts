import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  ChannelToggles,
  DigestFrequency,
  NotificationCategory,
  UpdateNotificationPreferenceDto,
} from '@gitroom/nestjs-libraries/dtos/notifications/notification-preference.dto';

type JsonInput = Prisma.InputJsonValue;

export interface NotificationPreferenceData {
  masters: ChannelToggles;
  categories: Record<NotificationCategory, ChannelToggles>;
  digestFrequency: DigestFrequency;
}

export const DEFAULT_CATEGORY_TOGGLES: Record<NotificationCategory, ChannelToggles> = {
  post_published: { email: true, push: false, inApp: true },
  post_failed: { email: true, push: true, inApp: true },
  channels: { email: true, push: true, inApp: true },
  comments: { email: true, push: false, inApp: true },
  budget: { email: true, push: false, inApp: true },
  media: { email: false, push: false, inApp: true },
  announcements: { email: true, push: false, inApp: true },
  streak: { email: true, push: false, inApp: true },
  agent: { email: false, push: false, inApp: false },
  analytics: { email: true, push: false, inApp: true },
};

export const DEFAULT_MASTERS: ChannelToggles = {
  email: true,
  push: true,
  inApp: true,
};

@Injectable()
export class NotificationPreferenceService {
  constructor(
    private _preferences: PrismaRepository<'notificationPreference'>
  ) {}

  private _defaultData(): NotificationPreferenceData {
    return {
      masters: { ...DEFAULT_MASTERS },
      categories: { ...DEFAULT_CATEGORY_TOGGLES },
      digestFrequency: 'instant',
    };
  }

  toData(row: any): NotificationPreferenceData {
    const defaults = this._defaultData();
    const mergedCategories = { ...defaults.categories };
    const rowCategories = row.categories ?? {};
    for (const cat of Object.keys(mergedCategories) as NotificationCategory[]) {
      mergedCategories[cat] = { ...mergedCategories[cat], ...(rowCategories[cat] ?? {}) };
    }
    return {
      masters: { ...defaults.masters, ...(row.masters ?? {}) },
      categories: mergedCategories,
      digestFrequency: (row.digestFrequency as DigestFrequency) ?? defaults.digestFrequency,
    };
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceData> {
    const row = await this._preferences.model.notificationPreference.findUnique({
      where: { userId },
    });

    if (!row) {
      return this._defaultData();
    }

    return this.toData(row);
  }

  async ensureDefaults(userId: string): Promise<NotificationPreferenceData> {
    const existing = await this._preferences.model.notificationPreference.findUnique({
      where: { userId },
    });

    if (existing) {
      return this.toData(existing);
    }

    const defaults = this._defaultData();
    const created = await this._preferences.model.notificationPreference.create({
      data: {
        userId,
        masters: defaults.masters as unknown as JsonInput,
        categories: defaults.categories as unknown as JsonInput,
        digestFrequency: defaults.digestFrequency,
      },
    });

    return this.toData(created);
  }

  async ensureDefaultsForUsers(
    userIds: string[]
  ): Promise<Record<string, NotificationPreferenceData>> {
    if (userIds.length === 0) {
      return {};
    }

    const existingRows = await this._preferences.model.notificationPreference.findMany({
      where: { userId: { in: userIds } },
    });

    const result: Record<string, NotificationPreferenceData> = {};
    const existingIds = new Set<string>();

    for (const row of existingRows) {
      result[row.userId] = this.toData(row);
      existingIds.add(row.userId);
    }

    const missingUserIds = userIds.filter((id) => !existingIds.has(id));

    if (missingUserIds.length > 0) {
      const defaults = this._defaultData();
      await this._preferences.model.notificationPreference.createMany({
        data: missingUserIds.map((userId) => ({
          userId,
          masters: defaults.masters as unknown as JsonInput,
          categories: defaults.categories as unknown as JsonInput,
          digestFrequency: defaults.digestFrequency,
        })),
        skipDuplicates: true,
      });

      for (const userId of missingUserIds) {
        // Return a deep copy of the defaults so callers cannot mutate the shared
        // default object (or its nested category toggles) for other users.
        result[userId] = this.toData({});
      }
    }

    return result;
  }

  async updatePreferences(
    userId: string,
    body: UpdateNotificationPreferenceDto
  ): Promise<NotificationPreferenceData> {
    const current = await this.ensureDefaults(userId);

    const nextMasters = body.masters
      ? { ...current.masters, ...body.masters }
      : current.masters;

    const nextCategories: Record<NotificationCategory, ChannelToggles> = { ...current.categories };
    if (body.categories) {
      for (const cat of Object.keys(nextCategories) as NotificationCategory[]) {
        const incoming = (body.categories as Record<NotificationCategory, Partial<ChannelToggles>>)[cat];
        if (incoming) {
          nextCategories[cat] = { ...nextCategories[cat], ...incoming };
        }
      }
    }

    const updated = await this._preferences.model.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        masters: nextMasters as unknown as JsonInput,
        categories: nextCategories as unknown as JsonInput,
        digestFrequency: body.digestFrequency ?? current.digestFrequency,
      },
      update: {
        masters: nextMasters as unknown as JsonInput,
        categories: nextCategories as unknown as JsonInput,
        digestFrequency: body.digestFrequency ?? current.digestFrequency,
      },
    });

    return this.toData(updated);
  }

  async isChannelEnabled(
    userId: string,
    category: NotificationCategory,
    channel: keyof ChannelToggles
  ): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    return prefs.masters[channel] && prefs.categories[category][channel];
  }

  async orgHasCategoryEnabled(
    orgId: string,
    category: NotificationCategory
  ): Promise<boolean> {
    const rows = await this._preferences.model.notificationPreference.findMany({
      where: {
        user: {
          organizations: {
            some: {
              organizationId: orgId,
              disabled: false,
            },
          },
        },
      },
    });

    for (const row of rows) {
      const prefs = this.toData(row);
      const cat = prefs.categories[category];
      if (!cat) continue;
      for (const channel of Object.keys(prefs.masters) as Array<keyof ChannelToggles>) {
        if (prefs.masters[channel] && cat[channel]) {
          return true;
        }
      }
    }

    return false;
  }

  async getDigestFrequencies(userIds: string[]): Promise<
    Record<string, DigestFrequency>
  > {
    if (userIds.length === 0) return {};
    const rows = await this._preferences.model.notificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, digestFrequency: true },
    });
    return rows.reduce((acc, row) => {
      acc[row.userId] = row.digestFrequency as DigestFrequency;
      return acc;
    }, {} as Record<string, DigestFrequency>);
  }

  async getPreferencesByDigestFrequency(frequency: DigestFrequency): Promise<
    Array<{ userId: string; user: { email: string } }>
  > {
    return this._preferences.model.notificationPreference.findMany({
      where: {
        digestFrequency: frequency,
        user: {
          activated: true,
          organizations: {
            some: {
              disabled: false,
            },
          },
        },
      },
      select: {
        userId: true,
        user: { select: { email: true } },
      },
    });
  }
}
