/**
 * Canonical bounds for the DesignerDoc contract. Kept dependency-free so both
 * the frontend and the backend can import it without pulling in zod or UI code.
 */

/** Maximum number of outputs (pages) in any document. */
export const MAX_OUTPUTS = 30;

/** Maximum elements per image output. */
export const MAX_ELEMENTS_PER_OUTPUT = 500;

/** Maximum video tracks per video output. */
export const MAX_TRACKS = 40;

/** Maximum clips per video track. */
export const MAX_CLIPS_PER_TRACK = 500;

/** Maximum CSS filter tokens per element or clip. */
export const MAX_FILTERS_PER_ELEMENT = 16;

/** Maximum text length on a text element. */
export const MAX_TEXT_LEN = 20000;

/**
 * Maximum logical single dimension (width/height) for an output or element.
 * This is the authoring/design-time ceiling.
 */
export const MAX_DIMENSION = 16384;

/**
 * Maximum rendered canvas dimension in pixels. The renderer multiplies logical
 * size by `pixelRatio` (up to 4x), so the rendered surface is clamped to this
 * value to stay within the node-canvas/Cairo single-surface limit (~32767).
 */
export const MAX_CANVAS_DIMENSION = 16384;

/** Maximum font size in px. */
export const MAX_FONT_SIZE = 2000;

/** Maximum video duration in milliseconds (must equal video-render.service.ts). */
export const MAX_VIDEO_DURATION_MS = 60000;

/** Maximum ops in a single `applyOps` request. */
export const MAX_OPS_PER_REQUEST = 200;
