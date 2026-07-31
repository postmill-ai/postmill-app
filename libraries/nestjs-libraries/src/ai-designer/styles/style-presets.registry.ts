import type { AiDesignerStylePreset } from './style-preset.interface';

// Font families below are restricted to the curated catalog in
// `media/design-render/font-loader.service.ts` — the registry spec asserts it.
const STYLE_PRESETS: AiDesignerStylePreset[] = [
  {
    id: 'bold',
    title: 'Bold',
    description: 'High-impact poster energy — huge condensed type and one loud accent.',
    palettes: [
      ['#0A0A0A', '#FFFFFF', '#FF4D00'],
      ['#111111', '#F5F5F5', '#FFD400'],
      ['#0B1D3A', '#FFFFFF', '#FF3366'],
    ],
    fonts: { display: 'Anton', body: 'Inter' },
    typeScale: { headline: 1, subhead: 0.42, cta: 0.3, legal: 0.16 },
    treatments: {
      headlineTransform: 'uppercase',
      letterSpacing: 0,
      textStroke: null,
      textShadow: false,
      ctaStyle: 'pill',
      badgeStyle: 'pill',
      accentShapes: true,
    },
    promptFragment: [
      'Poster-like confidence: one oversized uppercase headline dominates the layout.',
      'Dark or saturated field with a single loud accent color; generous contrast.',
      'Supporting copy is short and functional — never compete with the headline.',
      'CTA is a high-contrast pill; accents are simple geometric blocks or bars.',
    ].join('\n'),
  },
  {
    id: 'editorial',
    title: 'Editorial',
    description: 'Magazine layout — serif display type, whitespace, and refined hierarchy.',
    palettes: [
      ['#FAF7F2', '#1A1A1A', '#8A6D3B'],
      ['#FFFFFF', '#111111', '#B23A48'],
      ['#F4F1EA', '#2C2C2C', '#3D5A80'],
    ],
    fonts: { display: 'Playfair Display', body: 'Inter' },
    typeScale: { headline: 1, subhead: 0.38, cta: 0.26, legal: 0.16 },
    treatments: {
      headlineTransform: 'none',
      letterSpacing: 0,
      textStroke: null,
      textShadow: false,
      ctaStyle: 'underline',
      badgeStyle: null,
      accentShapes: false,
    },
    promptFragment: [
      'Compose like a magazine spread: strong serif headline, clear hierarchy, ample whitespace.',
      'Muted paper-like background with one restrained accent used sparingly.',
      'Left-aligned text blocks feel at home; decoration limited to thin rules or hairlines.',
      'CTA reads as an underlined link or subtle text prompt, never a loud button.',
    ].join('\n'),
  },
  {
    id: 'minimal',
    title: 'Minimal',
    description: 'Quiet Swiss restraint — one typeface, few colors, lots of air.',
    palettes: [
      ['#FFFFFF', '#111111', '#6B7280'],
      ['#F8F8F8', '#1F2937', '#9CA3AF'],
      ['#FAFAFA', '#0F172A', '#475569'],
    ],
    fonts: { display: 'Inter', body: 'Inter' },
    typeScale: { headline: 1, subhead: 0.44, cta: 0.28, legal: 0.18 },
    treatments: {
      headlineTransform: 'none',
      letterSpacing: 0,
      textStroke: null,
      textShadow: false,
      ctaStyle: 'rect',
      badgeStyle: null,
      accentShapes: false,
    },
    promptFragment: [
      'Restraint above all: a single typeface, weight contrast instead of color contrast.',
      'Near-monochrome palette; at most one muted accent for the CTA.',
      'Generous margins and empty space are the design — do not fill them.',
      'No decorative shapes, shadows, or strokes; a plain rectangular CTA at most.',
    ].join('\n'),
  },
  {
    id: 'neon',
    title: 'Neon',
    description: 'Electric night glow — luminous accents on deep dark backgrounds.',
    palettes: [
      ['#050510', '#EAEAFF', '#00F0FF', '#FF00E5'],
      ['#0A0A14', '#F0F0FF', '#39FF14', '#FF2E88'],
      ['#070712', '#EDEDFF', '#7C3AED', '#22D3EE'],
    ],
    fonts: { display: 'Righteous', body: 'Space Mono' },
    typeScale: { headline: 1, subhead: 0.4, cta: 0.3, legal: 0.16 },
    treatments: {
      headlineTransform: 'uppercase',
      letterSpacing: 2,
      textStroke: null,
      textShadow: true,
      ctaStyle: 'outline',
      badgeStyle: 'pill',
      accentShapes: true,
    },
    promptFragment: [
      'Deep near-black background; text and accents glow like signage (soft colored shadow).',
      'Saturated electric accents — cyan, magenta, lime — against the dark field.',
      'Wide-tracked uppercase display type; monospace supporting copy fits the vibe.',
      'CTA is a glowing outline; thin neon lines or circles as decorative accents.',
    ].join('\n'),
  },
  {
    id: 'retro',
    title: 'Retro',
    description: '70s throwback — script display type, warm cream tones, sticker outlines.',
    palettes: [
      ['#F7E9D0', '#3B2F2F', '#E4572E', '#F2A007'],
      ['#FAF0DC', '#4A3728', '#D64541', '#2A9D8F'],
      ['#F3E5C0', '#333333', '#E76F51', '#264653'],
    ],
    fonts: { display: 'Pacifico', body: 'Courier Prime' },
    typeScale: { headline: 1, subhead: 0.4, cta: 0.3, legal: 0.18 },
    treatments: {
      headlineTransform: 'none',
      letterSpacing: 0,
      textStroke: { color: 'light', width: 2 },
      textShadow: true,
      ctaStyle: 'pill',
      badgeStyle: 'burst',
      accentShapes: true,
    },
    promptFragment: [
      'Warm cream or faded-paper background with earthy oranges, teals, and browns.',
      'Script display headline with a light sticker outline and a soft offset shadow.',
      'Typewriter-flavored supporting copy; slightly playful, never corporate.',
      'Starburst badges and pill CTAs suit the era; sun rays or simple stars as accents.',
    ].join('\n'),
  },
  {
    id: 'neobrutalism',
    title: 'Neobrutalism',
    description: 'Raw blocks and hard borders — flat color, thick outlines, no gradients.',
    palettes: [
      ['#FFFDF5', '#0A0A0A', '#FF6B35'],
      ['#FAF3E0', '#111111', '#2E86FF', '#FFD23F'],
      ['#FFFFFF', '#000000', '#FF3EA5', '#00C853'],
    ],
    fonts: { display: 'Bebas Neue', body: 'Space Mono' },
    typeScale: { headline: 1, subhead: 0.42, cta: 0.32, legal: 0.18 },
    treatments: {
      headlineTransform: 'uppercase',
      letterSpacing: 0,
      textStroke: null,
      textShadow: false,
      ctaStyle: 'rect',
      badgeStyle: 'burst',
      accentShapes: true,
    },
    promptFragment: [
      'Flat saturated color blocks with thick black borders — no gradients, no soft shadows.',
      'Off-white background; black text; one or two unapologetic accent colors.',
      'Condensed uppercase headline; monospace labels and supporting copy.',
      'CTA is a hard-edged rectangle with a thick border and an offset solid shadow.',
    ].join('\n'),
  },
  {
    id: 'corporate',
    title: 'Corporate',
    description: 'Clean and trustworthy — neutral blues, structured grid, crisp hierarchy.',
    palettes: [
      ['#FFFFFF', '#0F2A43', '#1F6FEB'],
      ['#F5F7FA', '#14213D', '#2B5CD3'],
      ['#FAFBFC', '#1B2A41', '#0E7490'],
    ],
    fonts: { display: 'Inter', body: 'Roboto' },
    typeScale: { headline: 1, subhead: 0.44, cta: 0.28, legal: 0.18 },
    treatments: {
      headlineTransform: 'none',
      letterSpacing: 0,
      textStroke: null,
      textShadow: false,
      ctaStyle: 'rect',
      badgeStyle: 'pill',
      accentShapes: false,
    },
    promptFragment: [
      'Trustworthy and structured: white or light-gray field, navy text, one blue accent.',
      'Clean grid alignment; every element feels deliberate and measured.',
      'Sans-serif throughout with weight-driven hierarchy; no decorative flourishes.',
      'CTA is a solid or lightly rounded rectangle in the accent color.',
    ].join('\n'),
  },
  {
    id: 'refined',
    title: 'Refined',
    description: 'Quiet luxury — elegant serif, warm neutrals, gold-accented restraint.',
    palettes: [
      ['#FBF9F6', '#1C1917', '#A38A5B'],
      ['#F7F4EF', '#292524', '#8C7851', '#44403C'],
      ['#FFFFFF', '#18181B', '#9F7E4F'],
    ],
    fonts: { display: 'Cormorant Garamond', body: 'Inter' },
    typeScale: { headline: 1, subhead: 0.36, cta: 0.24, legal: 0.15 },
    treatments: {
      headlineTransform: 'none',
      letterSpacing: 1,
      textStroke: null,
      textShadow: false,
      ctaStyle: 'outline',
      badgeStyle: 'ribbon',
      accentShapes: false,
    },
    promptFragment: [
      'Understated luxury: ivory background, near-black serif headline, a single metallic-gold accent.',
      'Thin elegant serif at large sizes; small, widely spaced supporting copy.',
      'Extreme restraint — one accent, no shapes, no shadows; hairline dividers at most.',
      'CTA is a thin outlined button or letter-spaced caps; nothing loud.',
    ].join('\n'),
  },
];

export const STYLE_PRESET_IDS = STYLE_PRESETS.map((p) => p.id) as [
  string,
  ...string[],
];

export const DEFAULT_STYLE_ID = 'bold';

/** Look up a preset by id; undefined for unknown ids. */
export function getStylePreset(
  id: string | undefined
): AiDesignerStylePreset | undefined {
  if (!id) return undefined;
  return STYLE_PRESETS.find((p) => p.id === id);
}

/** All presets, in registry order (a copy — callers must not mutate). */
export function listStylePresets(): AiDesignerStylePreset[] {
  return STYLE_PRESETS.slice();
}
