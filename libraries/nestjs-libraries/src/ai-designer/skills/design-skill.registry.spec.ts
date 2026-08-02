import { describe, expect, it } from 'vitest';
import { DESIGN_SKILLS } from './design-skill.registry';
import { LAYOUT_TEMPLATE_IDS } from '../agents/composer/ai-designer-composer.service';

const VALID_SLOT_KINDS = new Set([
  'text',
  'image',
  'cta-button',
  'badge',
  'accent-shape',
]);

describe('DESIGN_SKILLS registry', () => {
  it('gives every skill layoutHints referencing real gallery templates', () => {
    const gallery = new Set<string>(LAYOUT_TEMPLATE_IDS);
    for (const skill of DESIGN_SKILLS) {
      expect(
        skill.layoutHints.formatTemplates.length,
        `${skill.id} has no formatTemplates`
      ).toBeGreaterThan(0);
      for (const template of skill.layoutHints.formatTemplates) {
        expect(
          gallery.has(template),
          `${skill.id} references unknown template "${template}"`
        ).toBe(true);
      }
    }
  });

  it('gives every skill a slot schema with valid kinds and unique ids', () => {
    for (const skill of DESIGN_SKILLS) {
      const { slotSchema } = skill.layoutHints;
      expect(slotSchema.length, `${skill.id} has no slotSchema`).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const slot of slotSchema) {
        expect(slot.id.trim().length, `${skill.id} slot with empty id`).toBeGreaterThan(0);
        expect(ids.has(slot.id), `${skill.id} duplicate slot id "${slot.id}"`).toBe(false);
        ids.add(slot.id);
        expect(
          VALID_SLOT_KINDS.has(slot.kind),
          `${skill.id} slot "${slot.id}" has invalid kind "${slot.kind}"`
        ).toBe(true);
      }
    }
  });

  it('keeps the intake-critical fields declared on every skill', () => {
    for (const skill of DESIGN_SKILLS) {
      expect(Array.isArray(skill.requiredBriefFields)).toBe(true);
      expect(skill.requiredBriefFields).toContain('intent');
      expect(skill.systemPrompt.length).toBeGreaterThan(200);
    }
  });

  it('never lets the announcement skill demand a detail or date it was not given', () => {
    // Round 8 B3: the skill DEMANDED a supporting detail line and welcomed a
    // date badge unconditionally, so a brief with no date got an invented one
    // ("Effective Monday") straight onto the canvas.
    const announcement = DESIGN_SKILLS.find((s) => s.id === 'announcement');
    expect(announcement).toBeDefined();
    const prompt = announcement!.systemPrompt;
    expect(prompt).not.toContain('One supporting detail line:');
    expect(prompt).toContain('ONLY when the brief supplies');
    expect(prompt).toContain('Never invent a date, time, or place');
    expect(prompt).toContain('No date in the brief means no badge');
  });
});
