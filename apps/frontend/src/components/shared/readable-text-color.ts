/**
 * Pick a WCAG-AA-readable text color (black or white) for an arbitrary solid background.
 *
 * a11y: fixed `text-white` on brand/provider colors fails AA on lighter backgrounds (e.g. white
 * on the #ff3ea2 badge is ~3.25:1). Choosing by background luminance guarantees ≥4.58:1 for any
 * solid color. Threshold 0.179 is the black/white crossover (where both give ~4.58:1).
 *
 * Accepts `#rgb`, `#rrggbb`, or `rgb()/rgba()`; falls back to white if unparseable.
 */
export function readableTextColor(bg: string): '#000000' | '#ffffff' {
  const rgb = parseColor(bg);
  if (!rgb) return '#ffffff';
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.179 ? '#000000' : '#ffffff';
}

function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length >= 3 && p.every((x, i) => i > 2 || !Number.isNaN(x))) return [p[0], p[1], p[2]];
  }
  return null;
}
