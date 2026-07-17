import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import type { DesignerDoc } from './designer-doc.schema';

/** Current DesignerDoc schema version. */
export const DESIGNER_DOC_VERSION = 2;

let elementCounter = 0;

/**
 * Client-side intra-document id generator. Non-CSPRNG by design — these keys are
 * scoped to a single document and are re-minted server-side by
 * `assignIdsAndNormalize` before any security boundary.
 */
export const genId = () => `el-${Date.now()}-${++elementCounter}`;

export const matchPreset = (w: number, h: number) => {
  const exact = CHANNEL_PRESETS.find((p) => p.width === w && p.height === h);
  if (exact) return { formatId: exact.id, name: exact.name };
  // Fuzzy match by nearest aspect ratio
  const targetRatio = w / h;
  let best: { formatId: string; name: string } | null = null;
  let bestDiff = Infinity;
  for (const p of CHANNEL_PRESETS) {
    if (p.id === 'custom') continue;
    const diff = Math.abs(p.width / p.height - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { formatId: p.id, name: p.name };
    }
  }
  return best || { formatId: 'custom', name: `${w}×${h}` };
};

/**
 * Canonical minimal blank image document. Used by server-side defaults and the
 * agent tool when no doc/template is supplied. The richer `createEmptyDoc`
 * (video mode, preset matching) stays in the frontend store.
 */
export const createBlankDoc = (
  width = 1080,
  height = 1080
): DesignerDoc => {
  const m = matchPreset(width, height);
  return {
    version: DESIGNER_DOC_VERSION,
    mode: 'image',
    outputs: [
      {
        id: genId(),
        formatId: m.formatId,
        name: m.name,
        width,
        height,
        background: '#ffffff',
        children: [],
      },
    ],
  };
};

// Load-time migration: legacy { width, height, pages[] } → { mode, outputs[] }
export const migrateDoc = (raw: any): DesignerDoc => {
  if (raw && Array.isArray(raw.outputs)) {
    return {
      version: raw.version || DESIGNER_DOC_VERSION,
      mode: raw.mode || 'image',
      outputs: raw.outputs,
      attribution: raw.attribution,
    } as DesignerDoc;
  }
  const w = raw?.width || 1080;
  const h = raw?.height || 1080;
  const m = matchPreset(w, h);
  if (raw?.mode === 'video') {
    const preset = CHANNEL_PRESETS.find((p) => p.id === m.formatId);
    // Preserve any existing video tracks/clips from the legacy shape.
    const existingTracks = Array.isArray(raw?.tracks)
      ? raw.tracks.map((t: any) => ({
          id: t.id || genId(),
          type: t.type || 'video',
          clips: Array.isArray(t.clips) ? t.clips : [],
        }))
      : [];
    const tracks =
      existingTracks.length > 0
        ? existingTracks
        : [{ id: genId(), type: 'video' as const, clips: [] }];
    return {
      version: DESIGNER_DOC_VERSION,
      mode: 'video',
      outputs: [
        {
          id: genId(),
          formatId: m.formatId,
          name: m.name,
          width: w,
          height: h,
          fps: preset?.fps ?? 30,
          durationMs: preset?.maxDurationMs ?? 10000,
          tracks,
        },
      ],
      attribution: raw?.attribution,
    } as DesignerDoc;
  }
  const outputs = (raw?.pages || [
    { id: genId(), background: '#ffffff', children: [] },
  ]).map((p: any, i: number) => ({
    id: p.id || genId(),
    formatId: m.formatId,
    name: (raw?.pages?.length || 1) > 1 ? `${m.name} ${i + 1}` : m.name,
    width: w,
    height: h,
    background: p.background || '#ffffff',
    bg: p.bg,
    children: p.children || [],
  }));
  return {
    version: DESIGNER_DOC_VERSION,
    mode: 'image',
    outputs,
    attribution: raw?.attribution,
  } as DesignerDoc;
};
