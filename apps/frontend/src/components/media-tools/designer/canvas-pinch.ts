export interface CanvasPoint {
  x: number;
  y: number;
}

export interface PinchMeasurement {
  center: CanvasPoint;
  distance: number;
}

export const measureCanvasPinch = (
  points: [CanvasPoint, CanvasPoint]
): PinchMeasurement => ({
  center: {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  },
  distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
});

export const clampCanvasZoom = (zoom: number): number =>
  Math.max(0.1, Math.min(5, zoom));

export const canvasZoomAtPoint = ({
  scale,
  viewport,
  point,
  nextScale,
}: {
  scale: number;
  viewport: CanvasPoint;
  point: CanvasPoint;
  nextScale: number;
}): { scale: number; viewport: CanvasPoint } => {
  const clamped = clampCanvasZoom(nextScale);
  const documentPoint = {
    x: (point.x - viewport.x) / scale,
    y: (point.y - viewport.y) / scale,
  };
  return {
    scale: clamped,
    viewport: {
      x: point.x - documentPoint.x * clamped,
      y: point.y - documentPoint.y * clamped,
    },
  };
};
