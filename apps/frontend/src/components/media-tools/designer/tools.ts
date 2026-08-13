/**
 * The Designer tool palette — the single registry for all tools, mirroring the
 * role `actions.ts` plays for the menu bar and ⌘K palette. The rail, the flyout
 * menus, the options bar and the keyboard resolver all read from here; nothing
 * else should hard-code a tool id.
 *
 * Modelled on Photoshop: tools are organised into GROUPS that share one rail
 * slot and one shortcut letter. The slot shows whichever tool in the group was
 * used last, and Shift+letter cycles within the group.
 */

import type { FC } from 'react';
import type { IconProps } from '@postmill-ai/frontend/components/ui/icons';
import * as I from '@postmill-ai/frontend/components/ui/icons/designer-tools';

/** Which document modes a tool can be used in. Video mode has its own bindings. */
export type ToolMode = 'image';

export interface DesignerTool {
  id: string;
  /** Group id — tools sharing a group share a rail slot and a shortcut. */
  group: string;
  label: string;
  /** English fallback for the tooltip; translated via useT at the call site. */
  labelKey: string;
  /** Glyph shown in the rail slot and the flyout row. */
  icon: FC<IconProps>;
  /** CSS cursor used while this tool is active over the canvas. */
  cursor: string;
  /** Requires a raster layer (or creates one on first stroke). */
  requiresRaster?: boolean;
  /** Hidden unless the org has an active AI provider. */
  requiresAi?: boolean;
  /** Not yet implemented — rendered disabled in the flyout. */
  pending?: boolean;
}

export interface DesignerToolGroup {
  id: string;
  /** Bare-letter shortcut; Shift+letter cycles the group. */
  shortcut: string;
  tools: DesignerTool[];
}

const tool = (
  id: string,
  group: string,
  label: string,
  labelKey: string,
  icon: FC<IconProps>,
  cursor: string,
  extra: Partial<DesignerTool> = {}
): DesignerTool => ({ id, group, label, labelKey, icon, cursor, ...extra });

/**
 * The 16 groups, in rail order. The first tool of each group is its default.
 *
 * Pruned deliberately (agreed with the product owner): Slice and Slice Select
 * (1990s HTML-table export, nothing here consumes slices), both Type Mask tools
 * (superseded by a clipped text layer), and Mixer Brush / Pattern Stamp /
 * Color Replacement (wet-media simulation and a pattern library we don't have).
 */
export const TOOL_GROUPS: DesignerToolGroup[] = [
  {
    id: 'move',
    shortcut: 'v',
    tools: [
      tool('move', 'move', 'Move', 'tool_move', I.MoveToolIcon, 'default'),
      tool('artboard', 'move', 'Artboard', 'tool_artboard', I.ArtboardToolIcon, 'default'),
    ],
  },
  {
    id: 'marquee',
    shortcut: 'm',
    tools: [
      tool('marquee-rect', 'marquee', 'Rectangular Marquee', 'tool_marquee_rect', I.MarqueeRectIcon, 'crosshair'),
      tool('marquee-ellipse', 'marquee', 'Elliptical Marquee', 'tool_marquee_ellipse', I.MarqueeEllipseIcon, 'crosshair'),
      tool('marquee-row', 'marquee', 'Single Row Marquee', 'tool_marquee_row', I.MarqueeRowIcon, 'crosshair'),
      tool('marquee-column', 'marquee', 'Single Column Marquee', 'tool_marquee_column', I.MarqueeColumnIcon, 'crosshair'),
    ],
  },
  {
    id: 'lasso',
    shortcut: 'l',
    tools: [
      tool('lasso-polygonal', 'lasso', 'Polygonal Lasso', 'tool_lasso_polygonal', I.LassoPolygonalIcon, 'crosshair'),
      tool('lasso-magnetic', 'lasso', 'Magnetic Lasso', 'tool_lasso_magnetic', I.LassoMagneticIcon, 'crosshair'),
      tool('lasso-free', 'lasso', 'Lasso', 'tool_lasso_free', I.LassoFreeIcon, 'crosshair'),
      tool('lasso-brush', 'lasso', 'Selection Brush', 'tool_lasso_brush', I.LassoBrushIcon, 'crosshair'),
    ],
  },
  {
    id: 'select-object',
    shortcut: 'w',
    tools: [
      tool('object-select', 'select-object', 'Object Selection', 'tool_object_select', I.ObjectSelectIcon, 'crosshair', {
        requiresAi: true,
      }),
      tool('quick-select', 'select-object', 'Quick Selection', 'tool_quick_select', I.QuickSelectIcon, 'crosshair'),
    ],
  },
  {
    id: 'crop',
    shortcut: 'c',
    tools: [
      tool('crop', 'crop', 'Crop', 'tool_crop', I.CropToolIcon, 'crosshair'),
      tool('crop-perspective', 'crop', 'Perspective Crop', 'tool_crop_perspective', I.CropPerspectiveIcon, 'crosshair'),
    ],
  },
  {
    id: 'brush',
    shortcut: 'b',
    tools: [
      tool('brush', 'brush', 'Brush', 'tool_brush', I.BrushToolIcon, 'crosshair', { requiresRaster: true }),
      tool('pencil', 'brush', 'Pencil', 'tool_pencil', I.PencilToolIcon, 'crosshair', { requiresRaster: true }),
    ],
  },
  {
    id: 'stamp',
    shortcut: 's',
    tools: [
      tool('clone-stamp', 'stamp', 'Clone Stamp', 'tool_clone_stamp', I.CloneStampIcon, 'crosshair', {
        requiresRaster: true,
      }),
    ],
  },
  {
    id: 'eraser',
    shortcut: 'e',
    tools: [
      tool('eraser', 'eraser', 'Eraser', 'tool_eraser', I.EraserToolIcon, 'crosshair', { requiresRaster: true }),
    ],
  },
  {
    id: 'gradient',
    shortcut: 'g',
    tools: [
      tool('gradient', 'gradient', 'Gradient', 'tool_gradient', I.GradientToolIcon, 'crosshair'),
      tool('paint-bucket', 'gradient', 'Paint Bucket', 'tool_paint_bucket', I.PaintBucketIcon, 'crosshair', {
        requiresRaster: true,
      }),
    ],
  },
  {
    id: 'blur',
    shortcut: 'r',
    tools: [
      tool('blur', 'blur', 'Blur', 'tool_blur', I.BlurToolIcon, 'crosshair', { requiresRaster: true }),
      tool('sharpen', 'blur', 'Sharpen', 'tool_sharpen', I.SharpenToolIcon, 'crosshair', { requiresRaster: true }),
      tool('smudge', 'blur', 'Smudge', 'tool_smudge', I.SmudgeToolIcon, 'crosshair', { requiresRaster: true }),
    ],
  },
  {
    id: 'dodge',
    shortcut: 'o',
    tools: [
      tool('dodge', 'dodge', 'Dodge', 'tool_dodge', I.DodgeToolIcon, 'crosshair', { requiresRaster: true }),
      tool('burn', 'dodge', 'Burn', 'tool_burn', I.BurnToolIcon, 'crosshair', { requiresRaster: true }),
      tool('sponge', 'dodge', 'Sponge', 'tool_sponge', I.SpongeToolIcon, 'crosshair', { requiresRaster: true }),
    ],
  },
  {
    id: 'pen',
    shortcut: 'p',
    tools: [
      tool('pen', 'pen', 'Pen', 'tool_pen', I.PenToolIcon, 'crosshair'),
      tool('pen-freeform', 'pen', 'Freeform Pen', 'tool_pen_freeform', I.PenFreeformIcon, 'crosshair'),
      tool('pen-curvature', 'pen', 'Curvature Pen', 'tool_pen_curvature', I.PenCurvatureIcon, 'crosshair'),
      tool('pen-add-anchor', 'pen', 'Add Anchor Point', 'tool_pen_add_anchor', I.PenAddAnchorIcon, 'crosshair'),
      tool('pen-delete-anchor', 'pen', 'Delete Anchor Point', 'tool_pen_delete_anchor', I.PenDeleteAnchorIcon, 'crosshair'),
      tool('pen-convert-point', 'pen', 'Convert Point', 'tool_pen_convert_point', I.PenConvertPointIcon, 'crosshair'),
    ],
  },
  {
    id: 'type',
    shortcut: 't',
    tools: [
      tool('type-horizontal', 'type', 'Horizontal Type', 'tool_type_horizontal', I.TypeHorizontalIcon, 'text'),
      tool('type-vertical', 'type', 'Vertical Type', 'tool_type_vertical', I.TypeVerticalIcon, 'text'),
    ],
  },
  {
    id: 'path-select',
    shortcut: 'a',
    tools: [
      tool('path-select', 'path-select', 'Path Selection', 'tool_path_select', I.PathSelectIcon, 'default'),
      tool('direct-select', 'path-select', 'Direct Selection', 'tool_direct_select', I.DirectSelectIcon, 'default'),
    ],
  },
  {
    id: 'shape',
    shortcut: 'u',
    tools: [
      tool('shape-rect', 'shape', 'Rectangle', 'tool_shape_rect', I.ShapeRectIcon, 'crosshair'),
      tool('shape-ellipse', 'shape', 'Ellipse', 'tool_shape_ellipse', I.ShapeEllipseIcon, 'crosshair'),
      tool('shape-triangle', 'shape', 'Triangle', 'tool_shape_triangle', I.ShapeTriangleIcon, 'crosshair'),
      tool('shape-polygon', 'shape', 'Polygon', 'tool_shape_polygon', I.ShapePolygonIcon, 'crosshair'),
      tool('shape-star', 'shape', 'Star', 'tool_shape_star', I.ShapeStarIcon, 'crosshair'),
      tool('shape-line', 'shape', 'Line', 'tool_shape_line', I.ShapeLineIcon, 'crosshair'),
      tool('shape-custom', 'shape', 'Custom Shape', 'tool_shape_custom', I.ShapeCustomIcon, 'crosshair'),
    ],
  },
  {
    id: 'hand',
    shortcut: 'h',
    tools: [
      tool('hand', 'hand', 'Hand', 'tool_hand', I.HandToolIcon, 'grab'),
      tool('rotate-view', 'hand', 'Rotate View', 'tool_rotate_view', I.RotateViewIcon, 'grab'),
    ],
  },
];

/** The tool selected on a fresh editor. */
export const DEFAULT_TOOL_ID = 'move';

const ALL_TOOLS: DesignerTool[] = TOOL_GROUPS.flatMap((g) => g.tools);

const TOOL_BY_ID = new Map(ALL_TOOLS.map((t) => [t.id, t]));
const GROUP_BY_ID = new Map(TOOL_GROUPS.map((g) => [g.id, g]));

export const allTools = (): DesignerTool[] => ALL_TOOLS;

export const getTool = (id: string): DesignerTool | undefined => TOOL_BY_ID.get(id);

export const getGroup = (id: string): DesignerToolGroup | undefined => GROUP_BY_ID.get(id);

/** The group a tool belongs to, or undefined for an unknown id. */
export const groupOfTool = (toolId: string): DesignerToolGroup | undefined => {
  const t = TOOL_BY_ID.get(toolId);
  return t ? GROUP_BY_ID.get(t.group) : undefined;
};

/**
 * Resolve a keystroke to the tool that should become active.
 *
 * A bare letter selects the group's last-used tool (falling back to its first);
 * Shift+letter advances to the next tool in the group, wrapping — Photoshop's
 * cycling behaviour. Returns null when the key isn't a tool shortcut.
 */
export const resolveToolShortcut = (
  key: string,
  shiftKey: boolean,
  activeToolId: string,
  lastToolPerGroup: Record<string, string>
): string | null => {
  const letter = key.toLowerCase();
  const group = TOOL_GROUPS.find((g) => g.shortcut === letter);
  if (!group) return null;

  if (!shiftKey) {
    const remembered = lastToolPerGroup[group.id];
    const valid = remembered && group.tools.some((t) => t.id === remembered);
    return valid ? remembered : group.tools[0].id;
  }

  // Shift cycles. If the group isn't already active, start from its first tool
  // rather than jumping into the middle of it.
  const currentIndex = group.tools.findIndex((t) => t.id === activeToolId);
  if (currentIndex === -1) return group.tools[0].id;
  return group.tools[(currentIndex + 1) % group.tools.length].id;
};
