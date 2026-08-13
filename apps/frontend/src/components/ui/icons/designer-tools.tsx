'use client';

import React, { FC, ReactNode } from 'react';
import type { IconProps } from './index';

/**
 * Designer tool-palette icons — one per tool in `designer/tools.ts`.
 *
 * Kept in their own module rather than bloating `icons/index.tsx` with 45 more
 * exports, but still under `components/ui/icons/` as the UI standards require
 * (no icon npm package is permitted). Every glyph is a 20×20 `currentColor`
 * stroke so the rail's text-colour utilities theme them in both modes.
 */

const ICON_BASE = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Build a tool icon from its path content. */
const toolIcon = (body: ReactNode): FC<IconProps> => {
  const Icon: FC<IconProps> = ({ size = 18, className, ...props }) => (
    <svg {...ICON_BASE} width={size} height={size} className={className} {...props}>
      {body}
    </svg>
  );
  return Icon;
};

/** Marching-ants stroke used by every selection tool, so they read as a family. */
const ANTS = { strokeDasharray: '2.5 2' };

// ── 1. Move ──────────────────────────────────────────────────────────────────
export const MoveToolIcon = toolIcon(
  <>
    <path d="M10 2.5v15M2.5 10h15" />
    <path d="M10 2.5 7.6 5M10 2.5 12.4 5M10 17.5 7.6 15M10 17.5 12.4 15M2.5 10 5 7.6M2.5 10 5 12.4M17.5 10 15 7.6M17.5 10 15 12.4" />
  </>
);
export const ArtboardToolIcon = toolIcon(
  <>
    <rect x="4" y="4" width="12" height="12" rx="1" />
    <path d="M4 7.5h12M7.5 4v12" />
  </>
);

// ── 2. Marquee ───────────────────────────────────────────────────────────────
export const MarqueeRectIcon = toolIcon(<rect x="3" y="4.5" width="14" height="11" {...ANTS} />);
export const MarqueeEllipseIcon = toolIcon(<ellipse cx="10" cy="10" rx="7" ry="5.5" {...ANTS} />);
export const MarqueeRowIcon = toolIcon(
  <>
    <path d="M2.5 10h15" {...ANTS} />
    <path d="M2.5 7.5h15M2.5 12.5h15" opacity="0.35" />
  </>
);
export const MarqueeColumnIcon = toolIcon(
  <>
    <path d="M10 2.5v15" {...ANTS} />
    <path d="M7.5 2.5v15M12.5 2.5v15" opacity="0.35" />
  </>
);

// ── 3. Lasso ─────────────────────────────────────────────────────────────────
export const LassoPolygonalIcon = toolIcon(
  <>
    <path d="M3.5 8 8 3.5l7 3-2 6-6.5 1.5z" {...ANTS} />
    <circle cx="6.5" cy="14" r="1.1" />
  </>
);
export const LassoMagneticIcon = toolIcon(
  <>
    <path d="M4 12a6 6 0 1 1 12 0" {...ANTS} />
    <path d="M4 12v2.5h3V12M13 12v2.5h3V12" />
  </>
);
export const LassoFreeIcon = toolIcon(
  <>
    <path d="M6 15.5c-3-1.2-3.6-5-1.4-7.4C7 5.4 12 4.6 14.6 7c2.3 2.1 1.6 5.6-1.4 6.6-2.4.8-4.6-.4-4.4-2.1.2-1.4 2-2 3-1.2" />
    <path d="M6 15.5c-.8 1-.4 2 .8 2.2" />
  </>
);
export const LassoBrushIcon = toolIcon(
  <>
    <path d="M4 16c1.5-4 3.5-6.5 6-8" />
    <path d="M12.5 4.5 15.5 7.5 11 12 8 9z" />
    <path d="M3 17.5h5" {...ANTS} />
  </>
);

// ── 4. Object / Quick selection ──────────────────────────────────────────────
export const ObjectSelectIcon = toolIcon(
  <>
    <path d="M3.5 7V4.5H6M14 4.5h2.5V7M16.5 13v2.5H14M6 15.5H3.5V13" {...ANTS} />
    <path d="M10 7.2l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" />
  </>
);
export const QuickSelectIcon = toolIcon(
  <>
    <circle cx="8" cy="11" r="4" {...ANTS} />
    <path d="M11.5 8.5 15 5" />
    <path d="M13.6 3.2 16.8 6.4 15 8.2 11.8 5z" />
  </>
);

// ── 5. Crop ──────────────────────────────────────────────────────────────────
export const CropToolIcon = toolIcon(
  <>
    <path d="M5.5 2.5v12h12" />
    <path d="M2.5 5.5h12v12" />
  </>
);
export const CropPerspectiveIcon = toolIcon(
  <>
    <path d="M4 15.5 6.5 5h7L16 15.5z" />
    <path d="M6.5 5 4 15.5M13.5 5 16 15.5" opacity="0.4" />
  </>
);

// ── 6. Brush ─────────────────────────────────────────────────────────────────
export const BrushToolIcon = toolIcon(
  <>
    <path d="M13.5 3.5 16.5 6.5 9 14l-3-3z" />
    <path d="M6 11c-1.6.6-2.3 2-2.5 4.5C6 15.3 7.4 14.6 8 13z" />
  </>
);
export const PencilToolIcon = toolIcon(
  <>
    <path d="M13.8 3.2 16.8 6.2 6.5 16.5 3 17.5l1-3.5z" />
    <path d="M12 5l3 3" />
  </>
);

// ── 7. Clone stamp ───────────────────────────────────────────────────────────
export const CloneStampIcon = toolIcon(
  <>
    <path d="M7.5 2.5h5v3l1.5 3.5h-8L7.5 5.5z" />
    <path d="M4 9h12v2.5H4z" />
    <path d="M10 11.5v6M5.5 17.5h9" />
  </>
);

// ── 8. Eraser ────────────────────────────────────────────────────────────────
export const EraserToolIcon = toolIcon(
  <>
    <path d="M8.5 16.5H16" />
    <path d="M3.8 12.2 10 6l4.5 4.5-5 5H6z" />
    <path d="M7 9l4.5 4.5" opacity="0.4" />
  </>
);

// ── 9. Gradient / bucket ─────────────────────────────────────────────────────
export const GradientToolIcon = toolIcon(
  <>
    <rect x="3" y="4" width="14" height="12" rx="1" />
    <path d="M3 13h14" opacity="0.3" />
    <path d="M3 10.5h14" opacity="0.55" />
    <path d="M3 8h14" opacity="0.8" />
  </>
);
export const PaintBucketIcon = toolIcon(
  <>
    <path d="M9 3.5 3.5 9l5 5 5.5-5.5z" />
    <path d="M6.2 6.3 9 3.5" />
    <path d="M16 11c1 1.4 1.5 2.4 1.5 3a1.5 1.5 0 0 1-3 0c0-.6.5-1.6 1.5-3z" />
  </>
);

// ── 10. Blur / sharpen / smudge ──────────────────────────────────────────────
export const BlurToolIcon = toolIcon(
  <path d="M10 3s5 5.2 5 8a5 5 0 0 1-10 0c0-2.8 5-8 5-8z" />
);
export const SharpenToolIcon = toolIcon(
  <>
    <path d="M10 3 16 16H4z" />
    <path d="M10 8v5" opacity="0.4" />
  </>
);
export const SmudgeToolIcon = toolIcon(
  <>
    <path d="M8 3.5s3.5 4.5 3.5 6.8a3.5 3.5 0 0 1-7 0C4.5 8 8 3.5 8 3.5z" />
    <path d="M12 14c2 0 3 .8 3 1.8s-1 1.7-3 1.7" opacity="0.55" />
  </>
);

// ── 11. Dodge / burn / sponge ────────────────────────────────────────────────
export const DodgeToolIcon = toolIcon(
  <>
    <circle cx="8.5" cy="8.5" r="4.5" />
    <path d="M11.8 11.8 17 17" />
  </>
);
export const BurnToolIcon = toolIcon(
  <>
    <path d="M11 2.5c.5 2.5-.8 3.6-1.8 4.8C8 8.7 7 10 7 12a4 4 0 0 0 8 0c0-3.2-2.5-4.8-4-9.5z" />
    <path d="M10.2 13.5a1.6 1.6 0 0 0 3.2 0c0-1-.8-1.6-1.3-2.8-.6 1-1.9 1.6-1.9 2.8z" opacity="0.45" />
  </>
);
export const SpongeToolIcon = toolIcon(
  <>
    <path d="M4 9.5c0-2.5 2.7-4.5 6-4.5s6 2 6 4.5V13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M7 9.2v.01M10 8.2v.01M13 9.2v.01M8.5 11.6v.01M11.8 11.6v.01" />
  </>
);

// ── 12. Pen ──────────────────────────────────────────────────────────────────
const PEN_NIB = <path d="M4 16.5 5.5 12 13 4.5 16 7.5 8.5 15z" />;
export const PenToolIcon = toolIcon(
  <>
    {PEN_NIB}
    <path d="M5.5 12 8.5 15" opacity="0.45" />
  </>
);
export const PenFreeformIcon = toolIcon(
  <>
    {PEN_NIB}
    <path d="M2.5 18c2-2.5 4-2.5 6-1" opacity="0.7" />
  </>
);
export const PenCurvatureIcon = toolIcon(
  <>
    {PEN_NIB}
    <path d="M2.5 17.5c3.5 0 4-4 7.5-4" opacity="0.7" />
  </>
);
export const PenAddAnchorIcon = toolIcon(
  <>
    {PEN_NIB}
    <path d="M14.5 13.5v4M12.5 15.5h4" />
  </>
);
export const PenDeleteAnchorIcon = toolIcon(
  <>
    {PEN_NIB}
    <path d="M12.5 15.5h4" />
  </>
);
export const PenConvertPointIcon = toolIcon(
  <>
    <path d="M3 15.5c0-6 4-9.5 9.5-9.5" />
    <path d="M3 15.5h3M12.5 6V3" opacity="0.5" />
    <circle cx="3" cy="15.5" r="1.3" />
    <circle cx="12.5" cy="6" r="1.3" />
  </>
);

// ── 13. Type ─────────────────────────────────────────────────────────────────
export const TypeHorizontalIcon = toolIcon(
  <>
    <path d="M4 5h12M10 5v11" />
    <path d="M7.5 16h5" />
  </>
);
export const TypeVerticalIcon = toolIcon(
  <>
    <path d="M15 4v12M15 10H4" />
    <path d="M4 7.5v5" />
  </>
);

// ── 14. Path selection ───────────────────────────────────────────────────────
export const PathSelectIcon = toolIcon(
  <path d="M5 2.5 15.5 10 10.5 11 8 16.5z" fill="currentColor" />
);
export const DirectSelectIcon = toolIcon(<path d="M5 2.5 15.5 10 10.5 11 8 16.5z" />);

// ── 15. Shapes ───────────────────────────────────────────────────────────────
export const ShapeRectIcon = toolIcon(<rect x="3" y="5" width="14" height="10" rx="1" />);
export const ShapeEllipseIcon = toolIcon(<circle cx="10" cy="10" r="6.5" />);
export const ShapeTriangleIcon = toolIcon(<path d="M10 3.5 17 16H3z" />);
export const ShapePolygonIcon = toolIcon(<path d="M10 3 16.6 7.8 14.1 15.6H5.9L3.4 7.8z" />);
export const ShapeStarIcon = toolIcon(
  <path d="M10 3 12.1 7.6 17 8.2l-3.6 3.4.9 4.9L10 14.2l-4.3 2.3.9-4.9L3 8.2l4.9-.6z" />
);
export const ShapeLineIcon = toolIcon(<path d="M3.5 16.5 16.5 3.5" />);
export const ShapeCustomIcon = toolIcon(
  <path d="M10 16.5S3.5 12.6 3.5 8.2A3.4 3.4 0 0 1 10 6.6a3.4 3.4 0 0 1 6.5 1.6c0 4.4-6.5 8.3-6.5 8.3z" />
);

// ── 16. Hand / rotate view ───────────────────────────────────────────────────
export const HandToolIcon = toolIcon(
  <path d="M6.5 10V5.2a1.3 1.3 0 0 1 2.6 0V9m0-1.3a1.3 1.3 0 0 1 2.6 0V9m0-.8a1.3 1.3 0 0 1 2.6 0v3.6c0 3-2 5.2-4.8 5.2-2.4 0-3.6-1-5-3.4l-1.4-2.4a1.3 1.3 0 0 1 2.2-1.4l1.2 1.7" />
);
export const RotateViewIcon = toolIcon(
  <>
    <path d="M16.5 10a6.5 6.5 0 1 1-2.4-5" />
    <path d="M16.8 2.5v3.2h-3.2" />
  </>
);

// ── Layers panel ─────────────────────────────────────────────────────────────
// Row and footer controls. Same 20×20 currentColor stroke as the tools above, so
// the panel's text-colour utilities theme them in both modes.

export const EyeIcon = toolIcon(
  <>
    <path d="M1.8 10S4.9 4.8 10 4.8 18.2 10 18.2 10 15.1 15.2 10 15.2 1.8 10 1.8 10z" />
    <circle cx="10" cy="10" r="2.4" />
  </>
);
export const EyeOffIcon = toolIcon(
  <>
    <path d="M7.3 5.4A7.6 7.6 0 0 1 10 4.8c5.1 0 8.2 5.2 8.2 5.2a15 15 0 0 1-2.6 3.1M4.6 6.9A15.2 15.2 0 0 0 1.8 10S4.9 15.2 10 15.2a7.7 7.7 0 0 0 3-.6" />
    <path d="M8.3 8.3a2.4 2.4 0 0 0 3.4 3.4" />
    <path d="M3 3l14 14" />
  </>
);
export const LockIcon = toolIcon(
  <>
    <rect x="4.5" y="8.8" width="11" height="7.7" rx="1.2" />
    <path d="M7 8.8V6.6a3 3 0 0 1 6 0v2.2" />
  </>
);
export const UnlockIcon = toolIcon(
  <>
    <rect x="4.5" y="8.8" width="11" height="7.7" rx="1.2" />
    <path d="M7 8.8V6.6a3 3 0 0 1 5.8-1" />
  </>
);

/** Footer: link this layer's edits across formats (our stand-in for Photoshop's link-layers). */
export const LinkLayersIcon = toolIcon(
  <>
    <path d="M8.4 11.6a2.8 2.8 0 0 0 4.2.3l2.2-2.2a2.9 2.9 0 0 0-4.1-4.1l-1.2 1.2" />
    <path d="M11.6 8.4a2.8 2.8 0 0 0-4.2-.3L5.2 10.3a2.9 2.9 0 0 0 4.1 4.1l1.2-1.2" />
  </>
);
/** Footer: layer style. Drawn as letters rather than a glyph, matching Photoshop's "fx". */
export const LayerStyleIcon: FC<IconProps> = ({ size = 18, className, ...props }) => (
  <svg {...ICON_BASE} width={size} height={size} className={className} {...props}>
    <text
      x="10"
      y="14"
      textAnchor="middle"
      fontSize="11"
      fontStyle="italic"
      fontFamily="serif"
      fill="currentColor"
      stroke="none"
    >
      fx
    </text>
  </svg>
);
/** Footer: clipping mask — an arrow tucking under the layer below (our layer-mask slot). */
export const ClippingMaskIcon = toolIcon(
  <>
    <rect x="8" y="3.5" width="8.5" height="6" rx="1" />
    <rect x="3.5" y="10.5" width="8.5" height="6" rx="1" />
    <path d="M6 7.5v3.5" />
  </>
);
/** Footer: new fill or adjustment layer — Photoshop's half-filled circle. */
export const FillAdjustmentIcon = toolIcon(
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none" />
  </>
);
export const NewGroupIcon = toolIcon(
  <path d="M2.5 15.5v-9a1 1 0 0 1 1-1h3.6l1.6 2h6.8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z" />
);
export const NewLayerIcon = toolIcon(
  <>
    <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
    <path d="M10 7v6M7 10h6" />
  </>
);
export const DeleteLayerIcon = toolIcon(
  <>
    <path d="M3.8 5.8h12.4" />
    <path d="M5.6 5.8 6.3 16a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.7-10.2" />
    <path d="M7.8 5.8V4.2a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v1.6" />
  </>
);

/** Footer: add a layer mask — a filled rect with a knocked-out circle. */
export const LayerMaskIcon = toolIcon(
  <>
    <rect x="3" y="4.5" width="14" height="11" rx="1.2" />
    <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />
  </>
);
