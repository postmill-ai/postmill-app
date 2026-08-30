import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type { DesignerDoc } from './designer-doc.schema';

/** Current DesignerDoc schema version. */
// Defined in designer-doc.limits so the schema can bound `version` by it
// without importing this module (which imports the schema's types).
export { DESIGNER_DOC_VERSION } from './designer-doc.limits';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';

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

/**
 * Load-time normalisation for the CURRENT document shape. This is input
 * hygiene, not a migration: a doc missing `version` is stamped with
 * `DESIGNER_DOC_VERSION`, `mode` defaults to image, and doc-level symbol
 * definitions are carried across so a re-normalise cannot drop every symbol
 * instance on the next load.
 *
 * Anything that is not the outputs-based shape is NOT rewritten — v1 ships
 * with zero legacy support, so a malformed doc passes through unchanged and
 * the zod schema downstream rejects it.
 */
export const migrateDoc = (raw: any): DesignerDoc => {
  if (!raw || !Array.isArray(raw.outputs)) {
    return raw as DesignerDoc;
  }
  return {
    version: raw.version || DESIGNER_DOC_VERSION,
    mode: raw.mode || 'image',
    outputs: raw.outputs,
    attribution: raw.attribution,
    // Symbol definitions live on the doc; omitting them here would drop every
    // symbol instance in the document on the next load.
    ...(Array.isArray(raw.symbols) ? { symbols: raw.symbols } : {}),
  } as DesignerDoc;
};
