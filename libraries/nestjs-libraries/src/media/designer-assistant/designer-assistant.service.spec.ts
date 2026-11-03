import { describe, expect, it, vi } from 'vitest';
import { DesignerAssistantService } from './designer-assistant.service';
import { DesignerCopyKind } from '@postmill-ai/nestjs-libraries/dtos/design/designer-assistant.dto';

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
  it('generates three-copy requests with bounded design and Brand style context', async () => {
    const { service, ai } = makeService();
    await service.generateCopy('org-1', {
      kind: DesignerCopyKind.Headline,
      prompt: 'Holiday sale',
      selectedText: 'Old headline',
      context: { type: 'text', text: 'Old headline', width: 400, height: 100 },
    });

    const [scope, prompt, _schema, options] = ai.generateObject.mock.calls[0];
    expect(scope).toBe('generator');
    expect(options.orgId).toBe('org-1');
    expect(prompt).toContain('exactly three distinct short headline alternatives');
    expect(prompt).toContain('#123456');
    expect(prompt).toContain('Georgia');
    expect(prompt).toContain('Holiday sale');
  });

  it('requests only structured, whitelisted suggestions with no asset inputs', async () => {
    const { service, ai } = makeService();
    await service.getSuggestions('org-1', {
      prompt: 'Improve spacing',
      context: { type: 'text', text: 'Headline', fill: '#ffffff' },
    });

    const [scope, prompt, _schema, options] = ai.generateObject.mock.calls[0];
    expect(scope).toBe('generator');
    expect(options.orgId).toBe('org-1');
    expect(prompt).toContain('font pairings, color combinations, layout, and spacing');
    expect(prompt).toContain('never include layout operations or asset URLs');
    expect(prompt).not.toContain('/uploads/');
  });

  it('falls back to the first Brand when no default is selected', async () => {
    const { service, brands, ai } = makeService();
    brands.getDefaultBrand.mockResolvedValue(null);
    brands.getBrands.mockResolvedValue([{ name: 'Fallback', palette: [], fontFamilies: [] }]);

    await service.getSuggestions('org-1', {});

    expect(brands.getBrands).toHaveBeenCalledWith('org-1');
    expect(ai.generateObject.mock.calls[0][1]).toContain('Fallback');
  });
});
