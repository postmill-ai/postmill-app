import type { DesignerDoc, DesignerElement, TextRun } from './designer.store';

/**
 * A single brand-compliance violation. `text` is the fully-interpolated English message
 * (kept for any caller that only needs plain text / a count); `key` + `vars` let the sole
 * render site (panels/brand-panel.tsx) translate it via `t(key, text, vars)` — this module
 * is a plain data/logic module (not a hook), so it can't call useT()/getT() itself.
 */
export interface BrandViolation {
  key: string;
  text: string;
  vars: Record<string, string | number>;
}

function normalizeHex(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    return v.toUpperCase();
  }
  return null;
}

function isBrandColor(value: string | undefined, brandColors: string[]): boolean {
  if (!value) return true;
  const hex = normalizeHex(value);
  if (!hex) return true; // non-hex values (e.g. gradients) are checked separately
  return brandColors.includes(hex);
}

function isBrandFont(value: string | undefined, brandFonts: string[]): boolean {
  if (!value) return true;
  return brandFonts.some((f) => f.toLowerCase() === value.toLowerCase());
}

function push(
  violations: BrandViolation[],
  key: string,
  text: string,
  vars: Record<string, string | number>
) {
  violations.push({ key, text, vars });
}

function collectColorViolations(
  el: DesignerElement,
  brandColors: string[],
  violations: BrandViolation[]
) {
  if (el.fill && !isBrandColor(el.fill, brandColors)) {
    push(violations, 'designer_brand_violation_fill', `${el.type} element uses off-brand fill ${el.fill}`, { type: el.type, fill: el.fill });
  }
  if (el.stroke && !isBrandColor(el.stroke, brandColors)) {
    push(violations, 'designer_brand_violation_stroke', `${el.type} element uses off-brand stroke ${el.stroke}`, { type: el.type, stroke: el.stroke });
  }
  if (el.textShadow?.color && !isBrandColor(el.textShadow.color, brandColors)) {
    push(violations, 'designer_brand_violation_text_shadow', `text shadow uses off-brand color ${el.textShadow.color}`, { color: el.textShadow.color });
  }
  if (el.textStroke?.color && !isBrandColor(el.textStroke.color, brandColors)) {
    push(violations, 'designer_brand_violation_text_outline', `text outline uses off-brand color ${el.textStroke.color}`, { color: el.textStroke.color });
  }
  if (el.boxShadow?.color && !isBrandColor(el.boxShadow.color, brandColors)) {
    push(violations, 'designer_brand_violation_box_shadow', `box shadow uses off-brand color ${el.boxShadow.color}`, { color: el.boxShadow.color });
  }
  if (el.fillGradient?.stops?.length) {
    el.fillGradient.stops.forEach((stop, i) => {
      if (!isBrandColor(stop.color, brandColors)) {
        push(violations, 'designer_brand_violation_gradient_stop', `gradient stop ${i + 1} uses off-brand color ${stop.color}`, { index: i + 1, color: stop.color });
      }
    });
  }
  if (el.richText?.length) {
    el.richText.forEach((run, i) => {
      if (run.fill && !isBrandColor(run.fill, brandColors)) {
        push(violations, 'designer_brand_violation_rich_text_color', `rich-text run ${i + 1} uses off-brand color ${run.fill}`, { index: i + 1, color: run.fill });
      }
    });
  }
}

function collectFontViolations(
  el: DesignerElement,
  brandFonts: string[],
  violations: BrandViolation[]
) {
  if (el.type !== 'text') return;
  if (el.fontFamily && !isBrandFont(el.fontFamily, brandFonts)) {
    push(violations, 'designer_brand_violation_font', `text element uses off-brand font ${el.fontFamily}`, { font: el.fontFamily });
  }
  if (el.richText?.length) {
    el.richText.forEach((run, i) => {
      if (run.fontFamily && !isBrandFont(run.fontFamily, brandFonts)) {
        push(violations, 'designer_brand_violation_rich_text_font', `rich-text run ${i + 1} uses off-brand font ${run.fontFamily}`, { index: i + 1, font: run.fontFamily });
      }
    });
  }
}

export interface BrandComplianceConfig {
  enforcement: boolean;
  adminOverride: boolean;
  brandColors: string[];
  brandFonts: string[];
}

export function getBrandViolations(
  doc: DesignerDoc,
  config: BrandComplianceConfig
): BrandViolation[] {
  if (!config.enforcement || config.adminOverride) return [];

  const colorEnforced = config.brandColors.length > 0;
  const fontEnforced = config.brandFonts.length > 0;
  if (!colorEnforced && !fontEnforced) return [];

  const violations: BrandViolation[] = [];
  for (const output of doc.outputs) {
    if (!('children' in output)) continue;
    for (const el of output.children) {
      if (el.hidden) continue;
      if (colorEnforced) collectColorViolations(el, config.brandColors, violations);
      if (fontEnforced) collectFontViolations(el, config.brandFonts, violations);
    }
  }

  return violations;
}
