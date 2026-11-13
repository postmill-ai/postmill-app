export const SNAP_SCREEN_PX = 6;
export const EQUAL_SPACING_DOCUMENT_PX = 2;

export const selectionIncludesDraggedNode = (
  attachedIds: string[],
  draggedId: string
): boolean => attachedIds.length > 1 && attachedIds.includes(draggedId);

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  verticalGuide: number | null;
  horizontalGuide: number | null;
}

export const snapToleranceForZoom = (zoom: number): number =>
  SNAP_SCREEN_PX / Math.max(0.01, Math.abs(zoom));

export const boundsForSnapBoxes = (boxes: SnapBox[]): SnapBox => {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
};

const nearestAxis = (
  edges: number[],
  targets: number[],
  tolerance: number
): { delta: number; guide: number } | null => {
  let nearest: { delta: number; guide: number } | null = null;
  for (const edge of edges) {
    for (const guide of targets) {
      const delta = guide - edge;
      if (
        Math.abs(delta) <= tolerance &&
        (!nearest || Math.abs(delta) < Math.abs(nearest.delta))
      ) {
        nearest = { delta, guide };
      }
    }
  }
  return nearest;
};

export const nearestSnap = (
  box: SnapBox,
  targetsX: number[],
  targetsY: number[],
  zoom: number
): SnapResult => {
  const tolerance = snapToleranceForZoom(zoom);
  const x = nearestAxis(
    [box.x, box.x + box.width / 2, box.x + box.width],
    targetsX,
    tolerance
  );
  const y = nearestAxis(
    [box.y, box.y + box.height / 2, box.y + box.height],
    targetsY,
    tolerance
  );
  return {
    dx: x?.delta ?? 0,
    dy: y?.delta ?? 0,
    verticalGuide: x?.guide ?? null,
    horizontalGuide: y?.guide ?? null,
  };
};
