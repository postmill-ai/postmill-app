import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import fs from 'fs';
import path from 'path';

import { AdminOrgsController } from './admin.orgs.controller';
import {
  LimitOverridesDto,
} from '@postmill-ai/nestjs-libraries/dtos/billing/limit-overrides.dto';
import { ManageAddonsDto } from '@postmill-ai/nestjs-libraries/dtos/billing/manage-addons.dto';
import { ADDONS } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { User } from '@prisma/client';

// Mirror the global ValidationPipe options so these tests prove the DTOs behave
// under whitelist + forbidNonWhitelisted.
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

const superAdmin = { isSuperAdmin: true } as User;
const member = { isSuperAdmin: false } as User;

describe('AdminOrgsController — registration (proves auth middleware applies)', () => {
  it('is registered in the authenticatedController array in api.module.ts', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'api.module.ts'),
      'utf8'
    );
    const block = source.match(
      /authenticatedController = \[([\s\S]*?)\];/
    );
    expect(block, 'authenticatedController array not found').toBeTruthy();
    expect(block![1]).toContain('AdminOrgsController');
    expect(source).toContain(
      "import { AdminOrgsController } from '@postmill-ai/backend/api/routes/admin.orgs.controller'"
    );
  });
});

describe('AdminOrgsController.setLimitOverrides', () => {
  const makeController = () => {
    const service = { setLimitOverrides: vi.fn().mockResolvedValue({}) };
    const controller = new AdminOrgsController(service as any);
    return { controller, service };
  };

  it('rejects non-super-admin callers with 403', () => {
    const { controller, service } = makeController();
    expect(() =>
      controller.setLimitOverrides(member, 'org-1', {
        overrides: { channel: 500 },
      })
    ).toThrowError(expect.objectContaining({ status: 403 }));
    expect(service.setLimitOverrides).not.toHaveBeenCalled();
  });

  it('delegates the override patch to SubscriptionService for super-admins', async () => {
    const { controller, service } = makeController();
    await controller.setLimitOverrides(superAdmin, 'org-1', {
      overrides: { channel: 500, team_members: null },
    });
    expect(service.setLimitOverrides).toHaveBeenCalledWith('org-1', {
      channel: 500,
      team_members: null,
    });
  });
});

describe('LimitOverridesDto', () => {
  it('accepts a valid sparse overrides map', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { channel: 500, storage_gb: 250 },
    });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('accepts null values (clear semantics)', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { channel: null, video_exports: null },
    });
    expect(await validate(dto, PIPE)).toHaveLength(0);
  });

  it('rejects unknown keys', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { not_a_limit: 5 },
    });
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects analytics_retention_days (deliberately not overridable)', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { analytics_retention_days: 365 },
    });
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects boolean feature keys (campaigns/api/mcp stay tier/lifetime)', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { campaigns: true },
    });
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-integer values', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { channel: 'five-hundred' },
    });
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative overrides', async () => {
    const dto = plainToInstance(LimitOverridesDto, {
      overrides: { channel: -5 },
    });
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing overrides object', async () => {
    const dto = plainToInstance(LimitOverridesDto, {});
    const errors = await validate(dto, PIPE);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('ManageAddonsDto', () => {
  it('accepts all 8 add-on types', async () => {
    for (const type of Object.keys(ADDONS)) {
      const dto = plainToInstance(ManageAddonsDto, { type, packs: 1 });
      expect(await validate(dto, PIPE), `type ${type}`).toHaveLength(0);
    }
    expect(Object.keys(ADDONS)).toHaveLength(8);
  });

  it('rejects an unknown add-on type', async () => {
    const dto = plainToInstance(ManageAddonsDto, { type: 'unicorns', packs: 1 });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'type')).toBe(true);
  });

  it('rejects packs < 1', async () => {
    const dto = plainToInstance(ManageAddonsDto, { type: 'channels', packs: 0 });
    const errors = await validate(dto, PIPE);
    expect(errors.some((e) => e.property === 'packs')).toBe(true);
  });
});
