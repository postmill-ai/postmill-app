import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DesignerSuggestionsDto, GenerateDesignerCopyDto } from './designer-assistant.dto';

const input = (x: number, y: number) => plainToInstance(GenerateDesignerCopyDto, {
  kind: 'headline',
  prompt: 'Holiday sale',
  context: { x, y },
});

const suggestionsInput = (context: Record<string, unknown>) =>
  plainToInstance(DesignerSuggestionsDto, { prompt: 'Improve this', context });

describe('DesignerAssistantContextDto', () => {
  it('accepts off-canvas positions within the Designer document range', async () => {
    expect(await validate(input(-120, -16384))).toHaveLength(0);
  });

  it('rejects positions outside the Designer document range', async () => {
    const errors = await validate(input(-16385, 16385));
    expect(errors[0].children?.map((error) => error.property)).toEqual(['x', 'y']);
  });

  it('accepts a bounded image selection', async () => {
    const errors = await validate(suggestionsInput({
      mode: 'image',
      selection: [
        { type: 'text', x: -20, y: 30, width: 400, height: 100 },
        { type: 'shape', x: 500, y: 30, width: 200, height: 100 },
      ],
    }));
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid modes and incomplete nested selection boxes', async () => {
    const errors = await validate(suggestionsInput({
      mode: 'presentation',
      selection: [{ type: 'text', x: 0 }],
    }));
    const context = errors[0];
    expect(context?.property).toBe('context');
    expect(context?.children?.map((error) => error.property).sort()).toEqual(['mode', 'selection']);
    const selection = context?.children?.find((error) => error.property === 'selection');
    expect(selection?.children?.[0].children?.map((error) => error.property).sort()).toEqual(['height', 'width', 'y']);
  });

  it('caps selection context at fifty elements', async () => {
    const selection = Array.from({ length: 51 }, (_, index) => ({
      type: 'text', x: index, y: 0, width: 10, height: 10,
    }));
    const errors = await validate(suggestionsInput({ selection }));
    expect(errors[0].children?.[0].property).toBe('selection');
    expect(errors[0].children?.[0].constraints).toHaveProperty('arrayMaxSize');
  });
});
