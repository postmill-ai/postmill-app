import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationPreferenceService,
  DEFAULT_CATEGORY_TOGGLES,
} from './notification-preference.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  const findMany = vi.fn();

  const makeRepo = (rows: any[]): PrismaRepository<'notificationPreference'> =>
    ({
      model: {
        notificationPreference: {
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue(rows),
        },
      },
    } as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('orgHasCategoryEnabled', () => {
    it('returns true when any org member has the category enabled on any channel', async () => {
      service = new NotificationPreferenceService(
        makeRepo([
          {
            masters: { email: true, push: true, inApp: true },
            categories: { agent: { email: false, push: false, inApp: true } },
          },
        ]) as any
      );

      const result = await service.orgHasCategoryEnabled('org-1', 'agent');
      expect(result).toBe(true);
    });

    it('returns false when no member has the category enabled', async () => {
      service = new NotificationPreferenceService(
        makeRepo([
          {
            masters: { email: true, push: true, inApp: true },
            categories: { agent: { email: false, push: false, inApp: false } },
          },
        ]) as any
      );

      const result = await service.orgHasCategoryEnabled('org-1', 'agent');
      expect(result).toBe(false);
    });

    it('returns false when the master channel is disabled even if the category toggle is on', async () => {
      service = new NotificationPreferenceService(
        makeRepo([
          {
            masters: { email: false, push: false, inApp: false },
            categories: { agent: { email: true, push: true, inApp: true } },
          },
        ]) as any
      );

      const result = await service.orgHasCategoryEnabled('org-1', 'agent');
      expect(result).toBe(false);
    });

    it('returns false when no preferences exist for the org', async () => {
      service = new NotificationPreferenceService(makeRepo([]) as any);

      const result = await service.orgHasCategoryEnabled('org-1', 'agent');
      expect(result).toBe(false);
    });

    it('backfills missing category keys from defaults before checking', async () => {
      service = new NotificationPreferenceService(
        makeRepo([
          {
            masters: { email: true, push: true, inApp: true },
            categories: {},
          },
        ]) as any
      );

      const result = await service.orgHasCategoryEnabled('org-1', 'agent');
      // Default agent toggles are all false, so no channel is enabled.
      expect(result).toBe(false);
    });
  });
});
