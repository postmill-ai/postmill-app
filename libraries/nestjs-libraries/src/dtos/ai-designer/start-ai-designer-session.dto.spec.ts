import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AiDesignerAcceptPlanDto,
  AiDesignerConfigDto,
  StartAiDesignerSessionDto,
} from './start-ai-designer-session.dto';

const makeDto = (config: Partial<AiDesignerConfigDto> & { variants: number }) => {
  return plainToInstance(StartAiDesignerSessionDto, {
    config: {
      channels: config.channels ?? ['ig-post'],
      variants: config.variants,
      ...config,
    },
    mode: 'prompt',
    nonce: 'nonce-1',
  });
};

describe('StartAiDesignerSessionDto', () => {
  it('accepts a valid channel preset id', async () => {
    const dto = makeDto({ channels: ['ig-post', 'x-post'], variants: 1 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects unknown channel ids with a message listing valid ids', async () => {
    const dto = makeDto({ channels: ['bogus-channel'], variants: 1 });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    const configErrors = errors.find((e) => e.property === 'config');
    expect(configErrors).toBeDefined();
    const nested = configErrors?.children?.find((c) => c.property === 'channels');
    expect(nested).toBeDefined();
    expect(nested?.constraints).toEqual(
      expect.objectContaining({
        isAiDesignerChannelPreset: expect.stringMatching(/channels must be valid preset ids/),
      })
    );
  });

  it('rejects an empty channels array when no custom sizes are provided', async () => {
    const dto = makeDto({ channels: [], variants: 1 });
    const errors = await validate(dto);

    const configErrors = errors.find((e) => e.property === 'config');
    const nested = configErrors?.children?.find((c) => c.property === 'channels');
    expect(nested?.constraints).toEqual(
      expect.objectContaining({
        aiDesignerChannelsOrCustomSizes: expect.stringMatching(
          /at least one channel or one custom size/
        ),
      })
    );
  });

  it('accepts an empty channels array when custom sizes are provided', async () => {
    const dto = makeDto({
      channels: [],
      customSizes: [{ width: 1080, height: 1350, name: '1080×1350' }],
      variants: 1,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts channels together with custom sizes', async () => {
    const dto = makeDto({
      channels: ['ig-post'],
      customSizes: [{ width: 300, height: 250 }],
      variants: 1,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a style preset id from the registry', async () => {
    const dto = makeDto({ channels: ['ig-post'], variants: 1, styleId: 'bold' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown styleId', async () => {
    const dto = makeDto({
      channels: ['ig-post'],
      variants: 1,
      styleId: 'vaporwave',
    });
    const errors = await validate(dto);

    const configErrors = errors.find((e) => e.property === 'config');
    const nested = configErrors?.children?.find((c) => c.property === 'styleId');
    expect(nested).toBeDefined();
    expect(nested?.constraints).toEqual(
      expect.objectContaining({ isIn: expect.any(String) })
    );
  });

  it('accepts a config without styleId (AI decides)', async () => {
    const dto = makeDto({ channels: ['ig-post'], variants: 1 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('AiDesignerAcceptPlanDto', () => {
  const makeAcceptDto = (extra: Record<string, unknown> = {}) =>
    plainToInstance(AiDesignerAcceptPlanDto, {
      replyTo: 'msg-1',
      nonce: 'nonce-1',
      ...extra,
    });

  it('accepts plan-card copy edits as a variant → slot → text record', async () => {
    const dto = makeAcceptDto({
      texts: { v1: { headline: 'Labor Day Sale', badge: 'LABOR26' } },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('still accepts a payload without texts (pre-edit clients)', async () => {
    const dto = makeAcceptDto({ variantId: 'v1', saveTemplate: true });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-object texts value', async () => {
    const dto = makeAcceptDto({ texts: 'not-an-object' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'texts')).toBe(true);
  });
});
