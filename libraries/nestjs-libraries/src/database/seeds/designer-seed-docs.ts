import { DESIGNER_DOC_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

// Hand-authored starter content for the Designer "Start a design" modal.
//
// These docs are the single source of truth for both the permanent system
// templates (DesignTemplateSeeder — visible to every org) and the dev-only demo
// designs (DemoSeeder). Every doc here is authored to pass DesignerDocService
// .validateStrict (see designer-seed-docs.spec.ts) so it renders in the editor
// and survives the create/apply round-trip (which re-validates via .validate).

type Box = [x: number, y: number, width: number, height: number];

const base = (id: string, [x, y, width, height]: Box) => ({
  id,
  x,
  y,
  width,
  height,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

const text = (
  id: string,
  box: Box,
  content: string,
  opts: {
    fontSize: number;
    fontWeight?: number;
    fill?: string;
    align?: 'left' | 'center' | 'right';
    fontFamily?: string;
    lineHeight?: number;
    letterSpacing?: number;
  }
) => ({
  ...base(id, box),
  type: 'text' as const,
  text: content,
  fontFamily: opts.fontFamily ?? 'Inter',
  fontSize: opts.fontSize,
  fontWeight: opts.fontWeight ?? 400,
  fill: opts.fill ?? '#111827',
  align: opts.align ?? 'left',
  lineHeight: opts.lineHeight ?? 1.2,
  letterSpacing: opts.letterSpacing ?? 0,
});

const rect = (id: string, box: Box, fill: string) => ({
  ...base(id, box),
  type: 'shape' as const,
  shape: 'rect' as const,
  fill,
});

const doc = (
  outId: string,
  formatId: string,
  name: string,
  width: number,
  height: number,
  background: string,
  children: ReturnType<typeof text | typeof rect>[]
): DesignerDoc =>
  ({
    version: DESIGNER_DOC_VERSION,
    mode: 'image',
    outputs: [{ id: outId, formatId, name, width, height, background, children }],
  }) as DesignerDoc;

// ── System templates (permanent, isSystem, org-agnostic) ────────────────────

export interface SystemTemplateSpec {
  name: string;
  category: string;
  doc: DesignerDoc;
}

export const SYSTEM_DESIGN_TEMPLATES: SystemTemplateSpec[] = [
  {
    name: 'Blank Canvas',
    category: 'Basic',
    doc: doc('o-blank', 'ig-post', 'Instagram Post', 1080, 1080, '#ffffff', []),
  },
  {
    name: 'Quote — Instagram Post',
    category: 'Social',
    doc: doc('o-quote', 'ig-post', 'Instagram Post', 1080, 1080, '#0f172a', [
      rect('r-accent', [90, 470, 180, 8], '#38bdf8'),
      text(
        't-quote',
        [90, 300, 900, 320],
        'Design is intelligence made visible.',
        { fontSize: 64, fontWeight: 700, fill: '#ffffff', align: 'center', lineHeight: 1.25 }
      ),
      text('t-author', [90, 700, 900, 60], '— Alina Wheeler', {
        fontSize: 30,
        fontWeight: 400,
        fill: '#94a3b8',
        align: 'center',
      }),
    ]),
  },
  {
    name: 'Announcement — Instagram Story',
    category: 'Social',
    doc: doc('o-story', 'ig-story', 'Instagram Story', 1080, 1920, '#111827', [
      text('t-kicker', [100, 300, 880, 60], 'BIG NEWS', {
        fontSize: 34,
        fontWeight: 700,
        fill: '#f59e0b',
        align: 'left',
        letterSpacing: 6,
      }),
      text('t-head', [100, 380, 880, 420], 'Something new is coming.', {
        fontSize: 96,
        fontWeight: 800,
        fill: '#ffffff',
        align: 'left',
        lineHeight: 1.1,
      }),
      rect('r-cta', [100, 1720, 500, 120], '#f59e0b'),
      text('t-cta', [100, 1752, 500, 60], 'Learn more', {
        fontSize: 40,
        fontWeight: 700,
        fill: '#111827',
        align: 'center',
      }),
    ]),
  },
  {
    name: 'Flash Sale — Promo',
    category: 'Marketing',
    doc: doc('o-sale', 'ig-post', 'Instagram Post', 1080, 1080, '#dc2626', [
      text('t-off', [90, 360, 900, 260], '50% OFF', {
        fontSize: 200,
        fontWeight: 800,
        fill: '#ffffff',
        align: 'center',
      }),
      text('t-sub', [90, 640, 900, 80], 'Everything, this weekend only', {
        fontSize: 44,
        fontWeight: 400,
        fill: '#fee2e2',
        align: 'center',
      }),
    ]),
  },
  {
    name: 'Title Card — X Post',
    category: 'Social',
    doc: doc('o-title', 'x-post', 'X (Twitter) Post', 1200, 675, '#f8fafc', [
      rect('r-bar', [0, 0, 12, 675], '#6366f1'),
      text('t-title', [90, 210, 1020, 180], 'How we cut build times in half', {
        fontSize: 68,
        fontWeight: 800,
        fill: '#0f172a',
        align: 'left',
        lineHeight: 1.1,
      }),
      text('t-byline', [90, 420, 1020, 50], 'A short engineering write-up', {
        fontSize: 32,
        fontWeight: 400,
        fill: '#64748b',
        align: 'left',
      }),
    ]),
  },
  {
    name: 'Webinar — YouTube Thumbnail',
    category: 'Marketing',
    doc: doc('o-thumb', 'yt-thumbnail', 'YouTube Thumbnail', 1280, 720, '#1e1b4b', [
      text('t-live', [80, 90, 400, 70], 'LIVE WEBINAR', {
        fontSize: 44,
        fontWeight: 700,
        fill: '#a78bfa',
        align: 'left',
        letterSpacing: 4,
      }),
      text('t-title', [80, 200, 1120, 360], 'Ship faster with AI-native workflows', {
        fontSize: 96,
        fontWeight: 800,
        fill: '#ffffff',
        align: 'left',
        lineHeight: 1.05,
      }),
    ]),
  },
];

// ── Demo designs (dev-only fixtures, org-scoped) ────────────────────────────
// Display names are clean (marketing-capture grade — no "Demo:" prefix);
// DemoSeeder's reset finds these rows via DEMO_DESIGN_NAMES (exact-name list)
// plus the legacy prefix for seeds created before the rename.

export const DEMO_DESIGN_PREFIX = 'Demo:';

export interface DemoDesignSpec {
  name: string;
  doc: DesignerDoc;
}

// Tiny silent WAV (0.05s, 8kHz mono) so the seeded music clip has a decodable
// src — the timeline renders a real audio bar without fetching anything.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

const vclip = (id: string, startMs: number, endMs: number, extra: Record<string, unknown> = {}) => ({
  id,
  startMs,
  endMs,
  ...extra,
});

// Multi-track launch film: 3 b-roll stills with dissolves, a product overlay,
// two text tracks, and a music bed — 5 tracks / 8 clips, so the timeline
// captures read as a real editor, not an empty shell.
const WINTER_FILM_DOC: DesignerDoc = {
  version: DESIGNER_DOC_VERSION,
  mode: 'video',
  outputs: [
    {
      id: 'o-demo-film',
      formatId: 'video-landscape',
      name: 'Landscape Video',
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 12000,
      tracks: [
        {
          id: 'trk-broll',
          type: 'image',
          clips: [
            vclip('c-broll-1', 0, 4000, {
              // Seeds hand-picked for wintery/outdoor content (picsum is
              // deterministic per seed): snowy pines / misty forest / ridge hike.
              src: 'https://picsum.photos/seed/highland-4/1920/1080',
              x: 0, y: 0, width: 1920, height: 1080,
              transitionOut: { type: 'dissolve', durationMs: 400 },
            }),
            vclip('c-broll-2', 4000, 8000, {
              src: 'https://picsum.photos/seed/alpine-dawn/1920/1080',
              x: 0, y: 0, width: 1920, height: 1080,
              transitionOut: { type: 'dissolve', durationMs: 400 },
            }),
            vclip('c-broll-3', 8000, 12000, {
              src: 'https://picsum.photos/seed/summit-9/1920/1080',
              x: 0, y: 0, width: 1920, height: 1080,
            }),
          ],
        },
        {
          id: 'trk-overlay',
          type: 'image',
          clips: [
            vclip('c-product', 8500, 11800, {
              src: 'https://picsum.photos/seed/solstice-19/600/450',
              x: 1380, y: 660, width: 440, height: 330,
              opacity: 0.95,
              transitionIn: { type: 'fade', durationMs: 300 },
            }),
          ],
        },
        {
          id: 'trk-headline',
          type: 'text',
          clips: [
            vclip('c-head-1', 600, 3800, {
              text: 'Conquer the cold.',
              fontFamily: 'Inter', fontSize: 110, fontWeight: 800, fill: '#ffffff',
              x: 160, y: 430, width: 1600, height: 180,
              transitionIn: { type: 'fade', durationMs: 300 },
            }),
            vclip('c-head-2', 8300, 11800, {
              text: 'The Winter Drop lands Friday.',
              fontFamily: 'Inter', fontSize: 72, fontWeight: 800, fill: '#ffffff',
              x: 160, y: 470, width: 1400, height: 140,
              transitionIn: { type: 'fade', durationMs: 300 },
            }),
          ],
        },
        {
          id: 'trk-lower',
          type: 'text',
          clips: [
            vclip('c-lower-1', 4200, 8000, {
              text: 'solsticesupply.com',
              fontFamily: 'Inter', fontSize: 44, fontWeight: 700, fill: '#f59e0b',
              x: 160, y: 940, width: 700, height: 70,
            }),
          ],
        },
        {
          id: 'trk-music',
          type: 'audio',
          autoDuck: true,
          clips: [vclip('c-music', 0, 12000, { src: SILENT_WAV, volume: 0.6 })],
        },
      ],
    },
  ],
} as DesignerDoc;

export const DEMO_DESIGNS: DemoDesignSpec[] = [
  { name: 'Winter Drop — Launch Film', doc: WINTER_FILM_DOC },
  {
    name: 'Launch Announcement',
    doc: doc('o-demo-1', 'ig-post', 'Instagram Post', 1080, 1080, '#111827', [
      text('t-1', [90, 380, 900, 220], 'We just shipped v1.0', {
        fontSize: 84,
        fontWeight: 800,
        fill: '#ffffff',
        align: 'center',
        lineHeight: 1.1,
      }),
      text('t-2', [90, 620, 900, 70], 'Thank you to our early users 🙌', {
        fontSize: 40,
        fontWeight: 400,
        fill: '#9ca3af',
        align: 'center',
      }),
    ]),
  },
  {
    name: 'Weekly Quote',
    doc: doc('o-demo-2', 'ig-post', 'Instagram Post', 1080, 1080, '#0f172a', [
      rect('r-1', [90, 470, 180, 8], '#38bdf8'),
      text('t-1', [90, 320, 900, 300], 'Make it work, then make it beautiful.', {
        fontSize: 60,
        fontWeight: 700,
        fill: '#ffffff',
        align: 'center',
        lineHeight: 1.25,
      }),
    ]),
  },
  {
    name: 'Flash Sale — Fireside Mug',
    doc: doc('o-demo-3', 'ig-post', 'Instagram Post', 1080, 1080, '#dc2626', [
      text('t-1', [90, 380, 900, 240], '48H SALE', {
        fontSize: 180,
        fontWeight: 800,
        fill: '#ffffff',
        align: 'center',
      }),
      text('t-2', [90, 660, 900, 80], 'Use code POSTMILL at checkout', {
        fontSize: 40,
        fontWeight: 400,
        fill: '#fee2e2',
        align: 'center',
      }),
    ]),
  },
];

// Exact display names of the demo designs — DemoSeeder's reset/count key.
export const DEMO_DESIGN_NAMES: string[] = DEMO_DESIGNS.map((d) => d.name);
