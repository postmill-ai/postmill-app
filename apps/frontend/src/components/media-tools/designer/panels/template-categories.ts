/**
 * Category grouping / ordering / filtering for the Designer template gallery
 * (templates panel). Pure module so the section order and filter behavior are
 * unit-testable without rendering the panel — the same rules drive the section
 * headers, the filter chips, and (phase 2) custom folders, which slot in where
 * sections are today.
 */

import { templateModeOf } from './template-mode';

export interface CategorizedTemplate {
  category?: string | null;
  /** Template-list payloads carry the stored doc; the mode drives the
   *  uncategorized-video bucketing below. */
  doc?: { mode?: string | null } | null;
}

/**
 * System template categories in seed order — see SYSTEM_DESIGN_TEMPLATES
 * (libraries/nestjs-libraries/src/database/seeds). They lead the gallery;
 * org-defined categories follow alphabetically. 'Video' ranks with them even
 * though no seeded system template uses it yet — it is the canonical bucket
 * for video-mode templates.
 */
export const SYSTEM_CATEGORY_ORDER = ['Basic', 'Social', 'Marketing', 'Video'] as const;

/** Chip key for the "show everything" filter. */
export const ALL_CATEGORIES_KEY = 'all';

/** Section key for templates with no (or a blank) category — shown as "Other". */
export const OTHER_CATEGORY_KEY = 'other';

/** Section key for video-mode templates with no explicit category. */
export const VIDEO_CATEGORY_KEY = 'video';

/** Canonical label for the video bucket (callers translate it for display). */
export const VIDEO_CATEGORY_LABEL = 'Video';

export interface TemplateSection<T extends CategorizedTemplate> {
  /** Stable key: lowercased category, or OTHER_CATEGORY_KEY. */
  key: string;
  /** Display label as first seen; null for the uncategorized bucket (the
   *  caller renders a translated "Other"). */
  label: string | null;
  templates: T[];
}

const normalize = (category?: string | null): string => (category ?? '').trim();

const keyFor = (category?: string | null): string => {
  const normalized = normalize(category);
  return normalized ? normalized.toLowerCase() : OTHER_CATEGORY_KEY;
};

/**
 * Uncategorized video templates bucket under 'video' instead of 'other' so the
 * gallery stays mode-filterable for templates saved before the Video category
 * existed. An explicit category always wins, for either mode.
 */
const sectionKeyFor = (template: CategorizedTemplate): string => {
  if (!normalize(template.category) && templateModeOf(template) === 'video') {
    return VIDEO_CATEGORY_KEY;
  }
  return keyFor(template.category);
};

/** Seed-order rank for system categories; everything else ties after them. */
const systemRank = (key: string): number => {
  const index = SYSTEM_CATEGORY_ORDER.findIndex((c) => c.toLowerCase() === key);
  return index === -1 ? SYSTEM_CATEGORY_ORDER.length : index;
};

/**
 * Groups templates into deterministic sections: system categories first (seed
 * order), then org categories alphabetically, "Other" always last. Grouping is
 * case-insensitive; the section label keeps the first-seen spelling (input is
 * the API's stable isSystem/name ordering, so the label is deterministic too).
 */
export const groupTemplatesByCategory = <T extends CategorizedTemplate>(
  templates: T[]
): TemplateSection<T>[] => {
  const byKey = new Map<string, TemplateSection<T>>();
  for (const template of templates) {
    const key = sectionKeyFor(template);
    let section = byKey.get(key);
    if (!section) {
      section = {
        key,
        label:
          key === OTHER_CATEGORY_KEY
            ? null
            : normalize(template.category) || VIDEO_CATEGORY_LABEL,
        templates: [],
      };
      byKey.set(key, section);
    }
    section.templates.push(template);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.key === OTHER_CATEGORY_KEY) return 1;
    if (b.key === OTHER_CATEGORY_KEY) return -1;
    const rankDiff = systemRank(a.key) - systemRank(b.key);
    if (rankDiff !== 0) return rankDiff;
    return a.key.localeCompare(b.key);
  });
};

/** ALL_CATEGORIES_KEY passes everything through; any other key keeps its section. */
export const filterTemplatesByCategory = <T extends CategorizedTemplate>(
  templates: T[],
  activeKey: string
): T[] => {
  if (activeKey === ALL_CATEGORIES_KEY) return templates;
  const normalizedKey = activeKey.trim().toLowerCase();
  return templates.filter((template) => sectionKeyFor(template) === normalizedKey);
};
