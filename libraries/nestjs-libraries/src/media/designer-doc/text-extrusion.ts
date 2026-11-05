import type { DesignerLayerStyle } from './designer-doc.schema';
import { styleOffset } from './layer-styles';

export const MAX_EXTRUSION_DEPTH = 200;

export interface VideoTextExtrusion {
  depth: number;
  angle?: number;
  color?: string;
  opacity?: number;
}

export const extrusionOffsets = (
  style: Pick<DesignerLayerStyle, 'depth' | 'angle' | 'useGlobalLight'>,
  ratio: number
): { x: number; y: number }[] => {
  const depth = Math.min(MAX_EXTRUSION_DEPTH, Math.max(0, style.depth ?? 24)) * ratio;
  const steps = Math.ceil(depth);
  if (!steps) return [];
  const offset = styleOffset({ ...style, type: 'extrusion', distance: depth });
  return Array.from({ length: steps }, (_, index) => {
    const fraction = (steps - index) / steps;
    return { x: offset.x * fraction, y: offset.y * fraction };
  });
};

export const textExtrusionSource = (): string => `
const DEFAULT_GLOBAL_LIGHT = 120;
const styleOffset = ${String(styleOffset)};
const MAX_EXTRUSION_DEPTH = ${MAX_EXTRUSION_DEPTH};
const extrusionOffsets = ${String(extrusionOffsets)};
`;
