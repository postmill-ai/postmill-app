import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { GenerateDesignerCopyDto } from './designer-assistant.dto';

const input = (x: number, y: number) => plainToInstance(GenerateDesignerCopyDto, {
  kind: 'headline',
  prompt: 'Holiday sale',
  context: { x, y },
});

describe('DesignerAssistantContextDto', () => {
  it('accepts off-canvas positions within the Designer document range', async () => {
    expect(await validate(input(-120, -16384))).toHaveLength(0);
  });

  it('rejects positions outside the Designer document range', async () => {
    const errors = await validate(input(-16385, 16385));
    expect(errors[0].children?.map((error) => error.property)).toEqual(['x', 'y']);
  });
});
