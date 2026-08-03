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

/**
 * Current DesignerDoc schema version.
 *
 * Lives here rather than in `designer-doc.migrate` so the schema can bound
 * `version` by it without importing the migration module, which imports the
 * schema's types back — a cycle.
 *
 * v3 added the `path` (Pen tools) and `raster` (paint tools) element types and
 * the `triangle`/`polygon` shapes — all additive, so v2 documents needed no
 * rewrite.
 *
 * v4 adds Photoshop-parity layers: `group`/`fill`/`adjustment` element types,
 * `parentId`, blend modes and layer styles. Also additive — no rewrite.
 *
 * `parentId` and `groupId` are deliberately SEPARATE concepts and both stay:
 *   - `groupId` is the cross-format reflow move-unit ("these travel together
 *     when the design is re-fitted to another format"). Reflow and the AI
 *     composer depend on it in ~40 places.
 *   - `parentId` is the Photoshop layer group ("these live in a folder and
 *     composite as one").
 * Auto-converting one into the other would both destabilise reflow and bury
 * every AI-generated design under dozens of folders it never asked for. When a
 * user makes a layer group we set both, so a folder also reflows as a unit.
 */
export const DESIGNER_DOC_VERSION = 4;

/** Maximum text length on a text element. */
export const MAX_TEXT_LEN = 20000;

/**
 * Maximum bezier nodes on a `path` element. Generous for hand-drawn Pen work
 * (the Freeform Pen simplifies its trail before storing), while still bounding
 * how much geometry one element can force the renderer to trace.
 */
export const MAX_PATH_NODES = 2000;

/**
 * Maximum group nesting the server renderer composites separately.
 *
 * Every group level costs one page-size offscreen canvas, so an arbitrarily
 * deep `parentId` chain — trivial to author, since each Group Layers wraps the
 * previous group — would hold that many buffers at once and exhaust the render
 * process. Past this depth members draw straight into their parent instead;
 * real documents nest two or three deep.
 */
export const MAX_GROUP_RENDER_DEPTH = 16;

/**
 * Maximum layer styles (effects) on one layer. Photoshop allows one of each of
 * its ten effect types plus multiples of a few; this bounds how much offscreen
 * compositing a single element can force per render.
 */
export const MAX_LAYER_STYLES = 24;

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
