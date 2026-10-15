/**
 * Colour strings as canvas contexts accept them.
 *
 * The document stores colours as plain strings (`ColorSchema`), and the colour
 * picker can emit an 8-digit hex (`#RRGGBBAA`) when a fill or gradient stop
 * carries alpha. Every modern BROWSER canvas parses that form, but it is CSS
 * Color 4 — not universal in canvas implementations — so the one string both
 * renderers are guaranteed to agree on is `rgba(r, g, b, a)`. Normalising at
 * the point a colour hits a context keeps the Konva canvas, the PNG export and
 * the node-canvas PDF painting the same pixels.
 *
 * Anything that is not an 8-digit hex passes through byte-identical — a
 * 6-digit hex stays a 6-digit hex — so opaque colours render exactly as they
 * always have.
 */
export const canvasColor = (
  color: string | undefined | null
): string | undefined => {
  if (color === undefined || color === null || color === '') return undefined;
  // A CanvasGradient reaching a fillStyle site passes through untouched.
  if (typeof color !== 'string') return color;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
    color.trim()
  );
  if (!m) return color;
  const alpha = parseInt(m[4], 16);
  // Opaque: collapse to the 6-digit form every parser already accepted.
  if (alpha === 255) return `#${m[1]}${m[2]}${m[3]}`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha / 255})`;
};
