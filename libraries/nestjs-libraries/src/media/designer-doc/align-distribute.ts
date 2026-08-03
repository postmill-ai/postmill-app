/**
 * Distribute, and the equal-spacing detection behind smart guides.
 *
 * Align already existed; distribute is its missing half — and the same spacing
 * maths answers "are these three evenly spaced?", which is what turns a plain
 * snap into a smart guide.
 */

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DistributeMode =
  | 'horizontal-centers'
  | 'vertical-centers'
  | 'horizontal-gaps'
  | 'vertical-gaps';

const centerX = (b: Box) => b.x + b.width / 2;
const centerY = (b: Box) => b.y + b.height / 2;

/**
 * New x/y for each box, spread evenly.
 *
 * The outermost two boxes never move — they define the span, exactly as in
 * Illustrator. Fewer than three boxes therefore has nothing to distribute.
 */
export const distribute = (
  boxes: Box[],
  mode: DistributeMode
): Record<string, { x?: number; y?: number }> => {
  if (boxes.length < 3) return {};

  const horizontal = mode === 'horizontal-centers' || mode === 'horizontal-gaps';
  const sorted = [...boxes].sort((a, b) =>
    horizontal ? centerX(a) - centerX(b) : centerY(a) - centerY(b)
  );
  const out: Record<string, { x?: number; y?: number }> = {};

  if (mode === 'horizontal-centers' || mode === 'vertical-centers') {
    const first = horizontal ? centerX(sorted[0]) : centerY(sorted[0]);
    const last = horizontal
      ? centerX(sorted[sorted.length - 1])
      : centerY(sorted[sorted.length - 1]);
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((box, i) => {
      const target = first + step * i;
      out[box.id] = horizontal
        ? { x: target - box.width / 2 }
        : { y: target - box.height / 2 };
    });
    return out;
  }

  // Equal GAPS: the span is edge-to-edge, and the boxes' own sizes are taken
  // out of it before the leftover is shared. Centre-distributing different-sized
  // boxes leaves visibly uneven gaps, which is why both modes exist.
  const start = horizontal ? sorted[0].x : sorted[0].y;
  const lastBox = sorted[sorted.length - 1];
  const end = horizontal ? lastBox.x + lastBox.width : lastBox.y + lastBox.height;
  const totalSize = sorted.reduce((sum, b) => sum + (horizontal ? b.width : b.height), 0);
  const gap = (end - start - totalSize) / (sorted.length - 1);

  let cursor = start;
  sorted.forEach((box) => {
    out[box.id] = horizontal ? { x: cursor } : { y: cursor };
    cursor += (horizontal ? box.width : box.height) + gap;
  });
  return out;
};

export interface SpacingGuide {
  /** The axis the equal spacing runs along. */
  axis: 'x' | 'y';
  /** The repeated gap, in document units. */
  gap: number;
  /** The two gaps that matched, as [start, end] pairs along the axis. */
  spans: { from: number; to: number }[];
}

/**
 * Equal-spacing detection: is the moving box the same distance from its
 * neighbour as they are from each other?
 *
 * This is what makes a smart guide "smart" — a plain snap only knows about
 * edges and centres, and cannot tell you that three cards are evenly spread.
 */
export const findEqualSpacing = (
  moving: Box,
  others: Box[],
  tolerance = 2
): SpacingGuide | null => {
  for (const axis of ['x', 'y'] as const) {
    const size = (b: Box) => (axis === 'x' ? b.width : b.height);
    const start = (b: Box) => (axis === 'x' ? b.x : b.y);
    const end = (b: Box) => start(b) + size(b);
    // Only boxes that overlap on the OTHER axis are in the same row/column —
    // otherwise a distant element in a corner produces a nonsense guide.
    const crossStart = (b: Box) => (axis === 'x' ? b.y : b.x);
    const crossEnd = (b: Box) => crossStart(b) + (axis === 'x' ? b.height : b.width);
    const inLine = others.filter(
      (b) => crossEnd(b) > crossStart(moving) && crossStart(b) < crossEnd(moving)
    );
    if (inLine.length < 2) continue;

    const row = [...inLine, moving].sort((a, b) => start(a) - start(b));
    const index = row.findIndex((b) => b.id === moving.id);

    const gapBetween = (a: Box, b: Box) => start(b) - end(a);
    const before = index > 0 ? gapBetween(row[index - 1], row[index]) : null;
    const after = index < row.length - 1 ? gapBetween(row[index], row[index + 1]) : null;

    if (before != null && after != null && Math.abs(before - after) <= tolerance) {
      return {
        axis,
        gap: (before + after) / 2,
        spans: [
          { from: end(row[index - 1]), to: start(row[index]) },
          { from: end(row[index]), to: start(row[index + 1]) },
        ],
      };
    }

    // The moving box at one end: match the gap the others already share.
    const neighbourGaps: number[] = [];
    for (let i = 0; i < row.length - 1; i++) {
      if (i === index || i + 1 === index) continue;
      neighbourGaps.push(gapBetween(row[i], row[i + 1]));
    }
    const own = index === 0 ? after : index === row.length - 1 ? before : null;
    if (own != null && neighbourGaps.some((g) => Math.abs(g - own) <= tolerance)) {
      const pairIndex = index === 0 ? 0 : row.length - 2;
      const otherIndex = neighbourGaps.length ? (index === 0 ? 1 : row.length - 3) : pairIndex;
      return {
        axis,
        gap: own,
        spans: [
          { from: end(row[pairIndex]), to: start(row[pairIndex + 1]) },
          { from: end(row[otherIndex]), to: start(row[otherIndex + 1]) },
        ],
      };
    }
  }
  return null;
};
