/**
 * A curated art-direction preset for the AI Designer.
 *
 * Presets are distilled from the MIT-licensed awesome-design-skills collection
 * and re-expressed for our render model (no runtime dependency). The composer
 * maps the relative `typeScale` ratios to concrete pixel sizes per output
 * format, and `treatments` are deterministic rules it can apply without
 * further LLM involvement.
 *
 * `fonts` MUST reference families from the curated catalog in
 * `libraries/nestjs-libraries/src/media/design-render/font-loader.service.ts`
 * — anything else silently falls back to sans-serif at render time. The
 * registry spec asserts this.
 */
export interface AiDesignerStylePreset {
  id: string; // 'bold'
  title: string; // 'Bold'
  /** One line, shown in the start-form selector. */
  description: string;
  /** 2-3 palettes (hex arrays, 3-5 colors: bg/surface, text, accent(s)). */
  palettes: string[][];
  /** Families from the curated catalog only. */
  fonts: { display: string; body: string };
  /** Relative ratios (headline = 1 baseline); the composer maps them to px. */
  typeScale: { headline: number; subhead: number; cta: number; legal: number };
  /** Deterministic treatment rules the composer can apply. */
  treatments: {
    headlineTransform?: 'uppercase' | 'none';
    /** Tracking for display text. */
    letterSpacing?: number;
    textStroke?: { color: 'dark' | 'light'; width: number } | null;
    textShadow?: boolean;
    ctaStyle: 'pill' | 'rect' | 'underline' | 'outline';
    /**
     * Corner treatment for the non-pill CTA shapes (`rect`/`outline`). One
     * shared 14%-of-height constant used to serve all of them, which shipped
     * a 9px radius on presets whose own promptFragment demands hard edges.
     * Omitted → `pill` for `ctaStyle: 'pill'`, `small` otherwise.
     */
    ctaRadius?: 'square' | 'small' | 'pill';
    /** Thick border on a solid CTA (neobrutalism's hard-edged block). */
    ctaBorder?: boolean;
    /** Offset solid shadow rect behind the CTA (neobrutalism). */
    ctaShadow?: boolean;
    badgeStyle?: 'pill' | 'burst' | 'ribbon' | null;
    /** Allow decorative geometric accents. */
    accentShapes?: boolean;
  };
  /** 3-6 lines of art-direction guidance for the plan LLM. */
  promptFragment: string;
}
