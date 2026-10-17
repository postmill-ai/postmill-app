import { describe, it, expect } from 'vitest';
import {
  ALL_CATEGORIES_KEY,
  OTHER_CATEGORY_KEY,
  VIDEO_CATEGORY_KEY,
  filterTemplatesByCategory,
  groupTemplatesByCategory,
} from './template-categories';

interface Template {
  id: string;
  category?: string | null;
  doc?: { mode?: string | null } | null;
}

const tmpl = (id: string, category?: string | null): Template => ({ id, category });
const videoTmpl = (id: string, category?: string | null): Template => ({
  id,
  category,
  doc: { mode: 'video' },
});

describe('groupTemplatesByCategory', () => {
  it('orders system categories in seed order regardless of input order', () => {
    const sections = groupTemplatesByCategory([
      tmpl('m1', 'Marketing'),
      tmpl('b1', 'Basic'),
      tmpl('s1', 'Social'),
    ]);
    expect(sections.map((s) => s.label)).toEqual(['Basic', 'Social', 'Marketing']);
  });

  it('puts org categories after system ones, alphabetically', () => {
    const sections = groupTemplatesByCategory([
      tmpl('z1', 'zebra'),
      tmpl('s1', 'Social'),
      tmpl('a1', 'announcements'),
      tmpl('b1', 'Basic'),
    ]);
    expect(sections.map((s) => s.key)).toEqual([
      'basic',
      'social',
      'announcements',
      'zebra',
    ]);
  });

  it('keeps uncategorized (missing or blank) templates last as the Other bucket', () => {
    const sections = groupTemplatesByCategory([
      tmpl('u1'),
      tmpl('b1', 'Basic'),
      tmpl('u2', '   '),
      tmpl('a1', 'custom'),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['basic', 'custom', OTHER_CATEGORY_KEY]);
    const other = sections[2];
    expect(other.label).toBeNull();
    expect(other.templates.map((t) => t.id)).toEqual(['u1', 'u2']);
  });

  it('groups case-insensitively and keeps the first-seen spelling as the label', () => {
    const sections = groupTemplatesByCategory([
      tmpl('s1', 'social'),
      tmpl('s2', 'Social'),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('social');
    expect(sections[0].label).toBe('social');
    expect(sections[0].templates.map((t) => t.id)).toEqual(['s1', 's2']);
  });

  it('matches system categories case-insensitively for seed ordering', () => {
    const sections = groupTemplatesByCategory([
      tmpl('m1', 'marketing'),
      tmpl('b1', 'BASIC'),
      tmpl('x1', 'xorg'),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['basic', 'marketing', 'xorg']);
  });

  it('trims surrounding whitespace from labels', () => {
    const sections = groupTemplatesByCategory([tmpl('t1', '  Promo  ')]);
    expect(sections[0].key).toBe('promo');
    expect(sections[0].label).toBe('Promo');
  });

  it('preserves input order within a section', () => {
    const sections = groupTemplatesByCategory([
      tmpl('b2', 'Basic'),
      tmpl('b1', 'Basic'),
      tmpl('b3', 'Basic'),
    ]);
    expect(sections[0].templates.map((t) => t.id)).toEqual(['b2', 'b1', 'b3']);
  });

  it('returns no sections for an empty gallery', () => {
    expect(groupTemplatesByCategory([])).toEqual([]);
  });

  it('buckets uncategorized video templates under Video, labeled Video', () => {
    const sections = groupTemplatesByCategory([videoTmpl('v1'), videoTmpl('v2', '  ')]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe(VIDEO_CATEGORY_KEY);
    expect(sections[0].label).toBe('Video');
    expect(sections[0].templates.map((t) => t.id)).toEqual(['v1', 'v2']);
  });

  it('keeps an explicit category on a video template', () => {
    const sections = groupTemplatesByCategory([videoTmpl('v1', 'Promo Reels')]);
    expect(sections[0].key).toBe('promo reels');
    expect(sections[0].label).toBe('Promo Reels');
  });

  it('still buckets uncategorized image templates as Other', () => {
    const sections = groupTemplatesByCategory([tmpl('i1')]);
    expect(sections[0].key).toBe(OTHER_CATEGORY_KEY);
  });

  it('ranks Video with the system categories, after Marketing', () => {
    const sections = groupTemplatesByCategory([
      videoTmpl('v1'),
      tmpl('m1', 'Marketing'),
      tmpl('z1', 'zebra'),
      tmpl('b1', 'Basic'),
    ]);
    expect(sections.map((s) => s.key)).toEqual([
      'basic',
      'marketing',
      VIDEO_CATEGORY_KEY,
      'zebra',
    ]);
  });
});

describe('filterTemplatesByCategory', () => {
  const templates = [
    tmpl('b1', 'Basic'),
    tmpl('s1', 'Social'),
    tmpl('u1'),
    tmpl('u2', ''),
  ];

  it('passes everything through for the All filter', () => {
    expect(filterTemplatesByCategory(templates, ALL_CATEGORIES_KEY)).toBe(templates);
  });

  it('keeps only the selected category (case-insensitive)', () => {
    expect(
      filterTemplatesByCategory(templates, 'social').map((t) => t.id)
    ).toEqual(['s1']);
    expect(
      filterTemplatesByCategory(templates, 'BASIC').map((t) => t.id)
    ).toEqual(['b1']);
  });

  it('the Other filter keeps only uncategorized templates', () => {
    expect(
      filterTemplatesByCategory(templates, OTHER_CATEGORY_KEY).map((t) => t.id)
    ).toEqual(['u1', 'u2']);
  });

  it('the Video filter keeps uncategorized video templates but not image ones', () => {
    const mixed = [
      videoTmpl('v1'),
      videoTmpl('v2', 'Promo Reels'),
      tmpl('u1'),
    ];
    expect(
      filterTemplatesByCategory(mixed, VIDEO_CATEGORY_KEY).map((t) => t.id)
    ).toEqual(['v1']);
    expect(
      filterTemplatesByCategory(mixed, OTHER_CATEGORY_KEY).map((t) => t.id)
    ).toEqual(['u1']);
  });
});
