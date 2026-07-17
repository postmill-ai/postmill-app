import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
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

  it('rejects an empty channels array', async () => {
    const dto = makeDto({ channels: [], variants: 1 });
    const errors = await validate(dto);

    const configErrors = errors.find((e) => e.property === 'config');
    const nested = configErrors?.children?.find((c) => c.property === 'channels');
    expect(nested?.constraints).toEqual(
      expect.objectContaining({
        arrayMinSize: expect.any(String),
      })
    );
  });
});
