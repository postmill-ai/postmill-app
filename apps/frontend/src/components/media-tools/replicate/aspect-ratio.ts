// Canvas-dimensions → Replicate `aspect_ratio` seeding. Replicate models express
// aspect as a `W:H` enum (16:9, 9:16, 1:1, …) — unlike the slideshow path's
// coarse wide/tall/square bucket (slide-aspect.ts), the seed must be a value the
// model's schema actually accepts, so the pick is the closest ratio the field's
// enum allows.

const CANDIDATES: Array<{ label: string; ratio: number }> = [
  { label: '21:9', ratio: 21 / 9 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '5:4', ratio: 5 / 4 },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '9:16', ratio: 9 / 16 },
];

function parseRatio(value: unknown): { label: string; ratio: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;
  return { label: value.trim(), ratio: w / h };
}

/**
 * The closest `W:H` aspect ratio for a canvas of `width`×`height`.
 *
 * When `allowed` (the schema field's enum) is given, only values the model
 * accepts are considered — an enum of unparsable entries (or a canvas with no
 * usable dimensions) yields undefined, and the caller leaves the field at its
 * schema default instead of seeding a value the provider would reject.
 */
export function closestAspectRatio(
  width: number | undefined,
  height: number | undefined,
  allowed?: unknown[]
): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const pool = (
    allowed?.length
      ? allowed.map(parseRatio).filter((c): c is { label: string; ratio: number } => !!c)
      : CANDIDATES
  ) as { label: string; ratio: number }[];
  if (!pool.length) return undefined;
  const target = Math.log(width / height);
  let best = pool[0];
  for (const c of pool) {
    if (Math.abs(Math.log(c.ratio) - target) < Math.abs(Math.log(best.ratio) - target)) {
      best = c;
    }
  }
  return best.label;
}
