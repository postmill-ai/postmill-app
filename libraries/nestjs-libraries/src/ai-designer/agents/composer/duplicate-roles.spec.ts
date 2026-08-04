import { describe, it, expect, vi } from 'vitest';
import { AiDesignerComposerService } from './ai-designer-composer.service';
import { DesignerDocService } from '../../../media/designer-doc/designer-doc.service';

// A poster's echo headline: two plan-declared headline slots with the same
// copy ("PIZZA" twice) must BOTH compose. The doc validator's duplicate-copy
// dedupe kills cross-role repetition (badge = CTA), not a design device the
// user approved on the plan card.
describe('AiDesignerComposerService duplicate-role slots', () => {
  it('composes both headline slots when a plan has two', async () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const doc = await service.compose({
      plan: {
        variantId: 'v1',
        skill: 'social',
        concept: 'Pizza',
        formatTemplate: 'hero-fullbleed',
        composition: 'poster-left',
        styleId: 'bold',
        palette: [],
        typeScale: {},
        background: { kind: 'solid', value: '#0A0A0A' },
        slots: [
          { id: 'img', role: 'image', kind: 'image' },
          { id: 'headline', role: 'headline', kind: 'text' },
          { id: 'sub', role: 'subhead', kind: 'text' },
          { id: 'headline2', role: 'headline', kind: 'text' },
          { id: 'cta', role: 'cta', kind: 'cta-button' },
        ],
        assetNeeds: [],
        texts: {
          headline: 'PIZZA',
          sub: 'Fresh & Tasty',
          headline2: 'PIZZA',
          cta: 'Shop now',
        },
      } as any,
      copy: {
        headline: 'PIZZA',
        sub: 'Fresh & Tasty',
        headline2: 'PIZZA',
        cta: 'Shop now',
      },
      assets: {
        img: { slotId: 'img', fileId: 'f1', path: 'https://example.com/i.png', type: 'image' },
      },
      outputs: [{ formatId: 'ig-square', width: 1080, height: 1080 }],
      orgId: 'o1',
      userId: 'u1',
    } as any);
    const oids = doc.outputs[0].children.map((el: any) => el.originId);
    expect(oids).toContain('headline');
    expect(oids).toContain('headline2');
  });
});
