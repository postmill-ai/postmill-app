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

export type CanvasWheelAction = 'pan' | 'zoom';

export const canvasWheelAction = ({
  touchpadMode,
  ctrlKey,
  metaKey,
}: {
  touchpadMode: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): CanvasWheelAction =>
  touchpadMode && !ctrlKey && !metaKey ? 'pan' : 'zoom';

export const normalizeCanvasWheel = ({
  deltaX,
  deltaY,
  deltaMode,
}: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): CanvasPoint => {
  const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
  return { x: deltaX * multiplier, y: deltaY * multiplier };
};

export const canvasPanViewport = (
  viewport: CanvasPoint,
  delta: CanvasPoint
): CanvasPoint => ({
  x: viewport.x - delta.x,
  y: viewport.y - delta.y,
});
