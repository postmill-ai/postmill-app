import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DesignerAssistantService } from './designer-assistant.service';
import { DesignerCopyKind } from '@postmill-ai/nestjs-libraries/dtos/design/designer-assistant.dto';

const validSuggestions = {
  suggestions: [
    {
      category: 'font',
      title: 'Use a clearer pairing',
      rationale: 'A display face will distinguish the headline.',
      style: { fontFamily: 'Georgia' },
    },
    {
      category: 'spacing',
      title: 'Increase the text spacing',
      rationale: 'More space around the headline will improve its hierarchy.',
    },
  ],
};

const invalidSuggestion = {
  suggestions: [
    {
      category: 'font',
      title: 'Unexpected key',
      rationale: 'The provider added an unapproved style property.',
      style: { fontFamily: 'Georgia', position: 'absolute' },
    },
    {
      category: 'spacing',
      title: 'Increase the text spacing',
      rationale: 'More space around the headline will improve its hierarchy.',
    },
  ],
};

const makeService = () => {
  const ai = { generateObject: vi.fn().mockResolvedValue({}) };
  const brands = {
    getDefaultBrand: vi.fn().mockResolvedValue({
      id: 'brand-1',
      name: 'Acme',
      palette: ['#123456'],
      fontFamilies: ['Georgia'],
    }),
    getBrands: vi.fn().mockResolvedValue([]),
  };
  return { service: new DesignerAssistantService(ai as any, brands as any), ai, brands };
};

describe('DesignerAssistantService', () => {
  it('generates three-copy requests with bounded design, Brand style, and an exact JSON contract', async () => {
    const { service, ai } = makeService();
    ai.generateObject.mockResolvedValue({ variants: ['One', 'Two', 'Three'] });
    await service.generateCopy('org-1', {
      kind: DesignerCopyKind.Headline,
      prompt: 'Holiday sale',
      selectedText: 'Old headline',
      context: { type: 'text', text: 'Old headline', width: 400, height: 100 },
    });

    const [scope, prompt, schema, options] = ai.generateObject.mock.calls[0];
    expect(scope).toBe('generator');
    expect(schema).toBeUndefined();
    expect(options.orgId).toBe('org-1');
    expect(prompt).toContain('exactly three distinct short headline alternatives');
    expect(prompt).toContain('{"variants":["alternative 1","alternative 2","alternative 3"]}');
    expect(prompt).toContain('root object must contain only "variants"');
    expect(prompt).toContain('#123456');
    expect(prompt).toContain('Georgia');
    expect(prompt).toContain('Holiday sale');
  });

  it('requests structured suggestions with semantic actions and no asset inputs', async () => {
    const { service, ai } = makeService();
    ai.generateObject.mockResolvedValue(validSuggestions);
    await service.getSuggestions('org-1', {
      prompt: 'Improve spacing',
      context: {
        type: 'text',
        text: 'Headline',
        fill: '#ffffff',
        mode: 'image',
        selection: [{ type: 'text', x: 10, y: 20, width: 300, height: 80 }],
      },
    });

    const [scope, prompt, schema, options] = ai.generateObject.mock.calls[0];
    expect(scope).toBe('generator');
    expect(schema).toBeUndefined();
    expect(options.orgId).toBe('org-1');
    expect(prompt).toContain('font pairings, color combinations, layout, and spacing');
    expect(prompt).toContain('root object must contain only "suggestions"');
    expect(prompt).toContain('with 2-6 entries');
    expect(prompt).toContain('"font", "color", "layout", or "spacing"');
    expect(prompt).toContain('only fontFamily');
    expect(prompt).toContain('or fill');
    expect(prompt).toContain('"type":"align"');
    expect(prompt).toContain('at least three elements are selected');
    expect(prompt).toContain('Never include asset URLs');
    expect(prompt).toContain('"selection":[{"type":"text","x":10,"y":20,"width":300,"height":80}]');
    expect(prompt).not.toContain('/uploads/');
  });

  it.each([
    { type: 'align', position: 'left' },
    { type: 'align', position: 'center' },
    { type: 'align', position: 'right' },
    { type: 'align', position: 'top' },
    { type: 'align', position: 'middle' },
    { type: 'align', position: 'bottom' },
    { type: 'distribute', mode: 'horizontal-centers' },
    { type: 'distribute', mode: 'vertical-centers' },
    { type: 'distribute', mode: 'horizontal-gaps' },
    { type: 'distribute', mode: 'vertical-gaps' },
  ])('accepts the whitelisted action $type/$position/$mode', async (action) => {
    const { service, ai } = makeService();
    ai.generateObject.mockResolvedValue({
      suggestions: [
        validSuggestions.suggestions[0],
        {
          category: 'layout',
          title: 'Apply the layout improvement',
          rationale: 'The semantic action implements this recommendation.',
          action,
        },
      ],
    });

    const result = await service.getSuggestions('org-1', {});
    expect(result.suggestions[1].action).toEqual(action);
  });

  it('rejects free-form action geometry', async () => {
    const { service, ai } = makeService();
    ai.generateObject.mockResolvedValue({
      suggestions: [
        validSuggestions.suggestions[0],
        {
          category: 'layout',
          title: 'Invalid geometry',
          rationale: 'Coordinates are not accepted.',
          action: { type: 'align', position: 'center', x: 500 },
        },
      ],
    });

    await expect(service.getSuggestions('org-1', {})).rejects.toThrow(BadGatewayException);
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
  });

  it('falls back to the first Brand when no default is selected', async () => {
    const { service, brands, ai } = makeService();
    ai.generateObject.mockResolvedValue(validSuggestions);
    brands.getDefaultBrand.mockResolvedValue(null);
    brands.getBrands.mockResolvedValue([{ name: 'Fallback', palette: [], fontFamilies: [] }]);

    await service.getSuggestions('org-1', {});

    expect(brands.getBrands).toHaveBeenCalledWith('org-1');
    expect(ai.generateObject.mock.calls[0][1]).toContain('Fallback');
  });

  it.each(['copy', 'suggestions'] as const)('retries one schema-invalid %s response and returns the valid correction', async (operation) => {
    const { service, ai } = makeService();
    const valid = operation === 'copy' ? { variants: ['One', 'Two', 'Three'] } : validSuggestions;
    ai.generateObject
      .mockResolvedValueOnce(operation === 'copy' ? ['One', 'Two', 'Three'] : { recommendations: [] })
      .mockResolvedValueOnce(valid);

    const result = await (operation === 'copy'
      ? service.generateCopy('org-1', { kind: DesignerCopyKind.Headline, prompt: 'Holiday sale' })
      : service.getSuggestions('org-1', {}));

    expect(result).toEqual(valid);
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    expect(ai.generateObject.mock.calls[1][1]).toContain('SCHEMA CORRECTION');
    expect(ai.generateObject.mock.calls[1][1]).toContain(operation === 'copy' ? '"variants"' : '"suggestions"');
  });

  it.each(['copy', 'suggestions'] as const)('turns two malformed %s responses into a readable 502', async (operation) => {
    const { service, ai } = makeService();
    ai.generateObject.mockResolvedValue(operation === 'copy'
      ? { variants: ['Only', 'Two'] }
      : invalidSuggestion);
    const request = operation === 'copy'
      ? service.generateCopy('org-1', { kind: DesignerCopyKind.Headline, prompt: 'Holiday sale' })
      : service.getSuggestions('org-1', {});

    await expect(request).rejects.toThrow(BadGatewayException);
    await expect(request).rejects.toThrow('The AI provider returned an invalid structured response. Please try again.');
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
  });

  it('does not retry a thrown provider error', async () => {
    const { service, ai } = makeService();
    const error = new Error('Provider quota exceeded');
    ai.generateObject.mockRejectedValue(error);

    await expect(service.generateCopy('org-1', {
      kind: DesignerCopyKind.Headline,
      prompt: 'Holiday sale',
    })).rejects.toBe(error);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });
});
