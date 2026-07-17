import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
  AnalyticsShareDto,
} from './alert-rule.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

// Integration.id is a cuid — the DTO must accept cuids (a prior @IsUUID()
// made every channel-scoped rule impossible to create).
const CUID = 'clxkq2z9w0000abcdmn123456';

describe('CreateAlertRuleDto (R2.5)', () => {
  const meta = { type: 'body' as const, metatype: CreateAlertRuleDto };
  const base = { metric: 'followers', comparator: 'gte', threshold: 100 };

  it('accepts a valid rule', async () => {
    await expect(pipe.transform(base, meta)).resolves.toMatchObject(base);
  });

  it('rejects a negative threshold (@Min(0))', async () => {
    await expect(
      pipe.transform({ ...base, threshold: -5 }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an absurdly large threshold (@Max)', async () => {
    await expect(
      pipe.transform({ ...base, threshold: 2_000_000_000 }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an over-long integrationId (@Length)', async () => {
    await expect(
      pipe.transform({ ...base, integrationId: 'x'.repeat(65) }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a cuid integrationId (Integration ids are cuids, not uuids)', async () => {
    await expect(
      pipe.transform({ ...base, integrationId: CUID }, meta),
    ).resolves.toMatchObject({ integrationId: CUID });
  });
});

describe('UpdateAlertRuleDto (R2.5)', () => {
  const meta = { type: 'body' as const, metatype: UpdateAlertRuleDto };

  it('rejects a negative threshold', async () => {
    await expect(
      pipe.transform({ threshold: -1 }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an empty-string integrationId (@Length)', async () => {
    await expect(
      pipe.transform({ integrationId: '' }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a cuid integrationId', async () => {
    await expect(
      pipe.transform({ integrationId: CUID }, meta),
    ).resolves.toMatchObject({ integrationId: CUID });
  });

  it('accepts an empty body (all optional)', async () => {
    await expect(pipe.transform({}, meta)).resolves.toEqual({});
  });
});

describe('AnalyticsShareDto (R2.6)', () => {
  const meta = { type: 'body' as const, metatype: AnalyticsShareDto };

  it('rejects an out-of-set rangePreset', async () => {
    await expect(
      pipe.transform({ rangePreset: 'junk' }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['7d', '30d', '90d'])('accepts rangePreset %s', async (rangePreset) => {
    await expect(
      pipe.transform({ rangePreset }, meta),
    ).resolves.toMatchObject({ rangePreset });
  });

  it('rejects an oversized integrations array (@ArrayMaxSize)', async () => {
    await expect(
      pipe.transform({ integrations: Array.from({ length: 51 }, (_, i) => `id${i}`) }, meta),
    ).rejects.toThrow(BadRequestException);
  });
});
