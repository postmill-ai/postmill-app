// Server-side types for the Designer render pipeline. The canonical contract now
// lives in ../designer-doc/designer-doc.schema.ts; this file re-exports it to
// preserve existing import paths while keeping a single source of truth.

export type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
  DesignerBackground,
  DesignerGradient,
  DesignerMask,
  TextRun,
  DesignerAttribution,
  DesignerPage,
  DesignerPageBackground,
} from '../designer-doc/designer-doc.schema';

export interface RenderOptions {
  pixelRatio?: number;
  transparent?: boolean;
  orgId?: string;
}
