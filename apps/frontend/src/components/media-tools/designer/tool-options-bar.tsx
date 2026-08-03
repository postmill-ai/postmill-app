'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { getTool } from './tools';

/**
 * The options bar — Photoshop's strip under the menu bar showing the active
 * tool's settings.
 *
 * Distinct from `SelectionToolbar`, which is contextual to the *selection*;
 * this one is contextual to the *tool* and is always present. Each tool's
 * controls are declared as a small schema here so adding a tool is a data
 * change, not a new component.
 */

export type ToolOptionSpec =
  | { kind: 'number'; key: string; label: string; labelKey: string; min: number; max: number; step?: number; suffix?: string; def: number }
  | { kind: 'toggle'; key: string; label: string; labelKey: string; def: boolean }
  | { kind: 'select'; key: string; label: string; labelKey: string; options: { value: string; label: string }[]; def: string };

/**
 * Per-tool option schemas. Tools absent from this map render the "no options"
 * hint rather than an empty bar, so the strip never looks broken.
 */
export const TOOL_OPTION_SPECS: Record<string, ToolOptionSpec[]> = {
  move: [
    { kind: 'toggle', key: 'autoSelect', label: 'Auto-select', labelKey: 'tool_opt_auto_select', def: true },
    { kind: 'toggle', key: 'showTransform', label: 'Show transform controls', labelKey: 'tool_opt_show_transform', def: true },
  ],
  artboard: [],
  'shape-rect': [
    { kind: 'number', key: 'cornerRadius', label: 'Radius', labelKey: 'tool_opt_radius', min: 0, max: 400, def: 0 },
    { kind: 'number', key: 'strokeWidth', label: 'Stroke', labelKey: 'tool_opt_stroke', min: 0, max: 100, def: 0 },
  ],
  'shape-polygon': [
    { kind: 'number', key: 'sides', label: 'Sides', labelKey: 'tool_opt_sides', min: 3, max: 24, def: 6 },
  ],
  'shape-star': [
    { kind: 'number', key: 'points', label: 'Points', labelKey: 'tool_opt_points', min: 3, max: 24, def: 5 },
    { kind: 'number', key: 'innerRatio', label: 'Inner', labelKey: 'tool_opt_inner_ratio', min: 5, max: 95, step: 1, suffix: '%', def: 50 },
  ],
  'shape-line': [
    { kind: 'number', key: 'strokeWidth', label: 'Weight', labelKey: 'tool_opt_weight', min: 1, max: 100, def: 3 },
  ],
  'type-horizontal': [
    { kind: 'number', key: 'fontSize', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 999, def: 32 },
  ],
  'type-vertical': [
    { kind: 'number', key: 'fontSize', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 999, def: 32 },
  ],
  crop: [
    {
      kind: 'select', key: 'ratio', label: 'Ratio', labelKey: 'tool_opt_ratio', def: 'free',
      options: [
        { value: 'free', label: 'Free' },
        { value: '1:1', label: '1:1' },
        { value: '4:5', label: '4:5' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
      ],
    },
    { kind: 'toggle', key: 'deleteCropped', label: 'Delete cropped pixels', labelKey: 'tool_opt_delete_cropped', def: false },
  ],
  gradient: [
    {
      kind: 'select', key: 'type', label: 'Type', labelKey: 'tool_opt_gradient_type', def: 'linear',
      options: [
        { value: 'linear', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
      ],
    },
  ],
  // Paint family — size/hardness/opacity are the shared vocabulary.
  brush: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 24 },
    { kind: 'number', key: 'hardness', label: 'Hardness', labelKey: 'tool_opt_hardness', min: 0, max: 100, suffix: '%', def: 80 },
    { kind: 'number', key: 'opacity', label: 'Opacity', labelKey: 'tool_opt_opacity', min: 1, max: 100, suffix: '%', def: 100 },
  ],
  pencil: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 8 },
    { kind: 'number', key: 'opacity', label: 'Opacity', labelKey: 'tool_opt_opacity', min: 1, max: 100, suffix: '%', def: 100 },
  ],
  eraser: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 32 },
    { kind: 'number', key: 'opacity', label: 'Opacity', labelKey: 'tool_opt_opacity', min: 1, max: 100, suffix: '%', def: 100 },
  ],
  'clone-stamp': [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Opacity', labelKey: 'tool_opt_opacity', min: 1, max: 100, suffix: '%', def: 100 },
  ],
  'paint-bucket': [
    { kind: 'number', key: 'tolerance', label: 'Tolerance', labelKey: 'tool_opt_tolerance', min: 0, max: 255, def: 32 },
  ],
  blur: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Strength', labelKey: 'tool_opt_strength', min: 1, max: 100, suffix: '%', def: 50 },
  ],
  sharpen: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Strength', labelKey: 'tool_opt_strength', min: 1, max: 100, suffix: '%', def: 50 },
  ],
  smudge: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Strength', labelKey: 'tool_opt_strength', min: 1, max: 100, suffix: '%', def: 50 },
  ],
  dodge: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Exposure', labelKey: 'tool_opt_exposure', min: 1, max: 100, suffix: '%', def: 50 },
  ],
  burn: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Exposure', labelKey: 'tool_opt_exposure', min: 1, max: 100, suffix: '%', def: 50 },
  ],
  sponge: [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 40 },
    { kind: 'number', key: 'opacity', label: 'Flow', labelKey: 'tool_opt_flow', min: 1, max: 100, suffix: '%', def: 50 },
    {
      kind: 'select', key: 'mode', label: 'Mode', labelKey: 'tool_opt_mode', def: 'saturate',
      options: [
        { value: 'saturate', label: 'Saturate' },
        { value: 'desaturate', label: 'Desaturate' },
      ],
    },
  ],

  // Selection family. Shift adds, Alt subtracts, Shift+Alt intersects.
  'marquee-rect': [],
  'marquee-ellipse': [],
  'marquee-row': [],
  'marquee-column': [],
  'lasso-polygonal': [],
  'lasso-free': [],
  'lasso-magnetic': [
    { kind: 'number', key: 'snapRadius', label: 'Width', labelKey: 'tool_opt_snap_width', min: 1, max: 40, def: 6 },
  ],
  'lasso-brush': [
    { kind: 'number', key: 'size', label: 'Size', labelKey: 'tool_opt_size', min: 1, max: 500, def: 24 },
  ],
  'quick-select': [
    { kind: 'number', key: 'tolerance', label: 'Tolerance', labelKey: 'tool_opt_tolerance', min: 0, max: 255, def: 32 },
  ],
  'object-select': [],

  // Pen family.
  pen: [
    { kind: 'number', key: 'strokeWidth', label: 'Weight', labelKey: 'tool_opt_weight', min: 0, max: 100, def: 2 },
  ],
  'pen-freeform': [
    { kind: 'number', key: 'strokeWidth', label: 'Weight', labelKey: 'tool_opt_weight', min: 0, max: 100, def: 2 },
  ],
  'pen-curvature': [
    { kind: 'number', key: 'strokeWidth', label: 'Weight', labelKey: 'tool_opt_weight', min: 0, max: 100, def: 2 },
  ],

  hand: [],
  'rotate-view': [
    { kind: 'number', key: 'angle', label: 'Angle', labelKey: 'tool_opt_angle', min: 0, max: 359, suffix: '°', def: 0 },
  ],
};

/** Defaults for a tool, so callers can read options before the user touches them. */
export const defaultToolOptions = (toolId: string): Record<string, unknown> => {
  const specs = TOOL_OPTION_SPECS[toolId] || [];
  return Object.fromEntries(specs.map((s) => [s.key, s.def]));
};

interface ToolOptionsBarProps {
  activeTool: string;
  options: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export const ToolOptionsBar: FC<ToolOptionsBarProps> = ({ activeTool, options, onChange }) => {
  const t = useT();
  const tool = getTool(activeTool);
  const specs = TOOL_OPTION_SPECS[activeTool];
  const ToolIcon = tool?.icon;

  const valueOf = (spec: ToolOptionSpec) =>
    options[spec.key] !== undefined ? options[spec.key] : spec.def;

  return (
    <div className="flex items-center gap-3 px-3 h-[38px] shrink-0 border-b border-studioBorder bg-newBgColorInner overflow-x-auto">
      <div className="flex items-center gap-2 shrink-0 pe-3 border-e border-studioBorder">
        {ToolIcon && <ToolIcon size={16} className="text-textColor/70" />}
        <span className="text-[12px] font-medium text-textColor whitespace-nowrap">
          {tool ? t(tool.labelKey, tool.label) : ''}
        </span>
      </div>

      {!specs?.length ? (
        <span className="text-[12px] text-textColor/40 whitespace-nowrap">
          {t('tool_no_options', 'No options for this tool')}
        </span>
      ) : (
        specs.map((spec) => (
          <label key={spec.key} className="flex items-center gap-1.5 shrink-0">
            <span className="text-[12px] text-textColor/60 whitespace-nowrap">
              {t(spec.labelKey, spec.label)}
            </span>

            {spec.kind === 'number' && (
              <>
                <input
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step ?? 1}
                  value={Number(valueOf(spec))}
                  onChange={(e) => onChange(spec.key, Number(e.target.value))}
                  className="w-[64px] h-[26px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none focus:border-designerAccent"
                />
                {spec.suffix && (
                  <span className="text-[12px] text-textColor/40">{spec.suffix}</span>
                )}
              </>
            )}

            {spec.kind === 'toggle' && (
              <input
                type="checkbox"
                checked={Boolean(valueOf(spec))}
                onChange={(e) => onChange(spec.key, e.target.checked)}
                className="w-4 h-4 accent-designerAccent"
              />
            )}

            {spec.kind === 'select' && (
              <select
                value={String(valueOf(spec))}
                onChange={(e) => onChange(spec.key, e.target.value)}
                className="h-[26px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none focus:border-designerAccent"
              >
                {spec.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        ))
      )}
    </div>
  );
};
