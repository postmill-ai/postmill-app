'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  TOOL_GROUPS,
  type DesignerTool,
  type DesignerToolGroup,
} from './tools';

/**
 * The Photoshop-style tool palette rail.
 *
 * One slot per group. The slot shows whichever tool in that group was used last
 * (so the icon always reflects the selected option, as specified) and carries a
 * corner marker when the group holds more than one tool. The flyout opens on
 * click-and-hold, on right-click, or from the keyboard — matching Photoshop
 * while staying reachable without a pointer.
 */

/** How long to hold before the flyout opens, in ms. */
const HOLD_MS = 250;

interface ToolRailProps {
  activeTool: string;
  lastToolPerGroup: Record<string, string>;
  onSelect: (toolId: string) => void;
  /** Tools requiring AI are hidden when the org has no active provider. */
  aiAvailable: boolean;
}

const visibleTools = (group: DesignerToolGroup, aiAvailable: boolean): DesignerTool[] =>
  group.tools.filter((t) => !t.requiresAi || aiAvailable);

/** The tool whose icon represents the group in the rail. */
const slotTool = (
  group: DesignerToolGroup,
  lastToolPerGroup: Record<string, string>,
  aiAvailable: boolean
): DesignerTool => {
  const tools = visibleTools(group, aiAvailable);
  const remembered = tools.find((t) => t.id === lastToolPerGroup[group.id]);
  return remembered || tools[0] || group.tools[0];
};

export const ToolRail: FC<ToolRailProps> = ({
  activeTool,
  lastToolPerGroup,
  onSelect,
  aiAvailable,
}) => {
  const t = useT();
  const [flyout, setFlyout] = useState<string | null>(null);
  /** Viewport position for the portalled flyout, taken from its rail button. */
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  /** Open a group's flyout, anchored beside the button that triggered it. */
  const openFlyout = useCallback((groupId: string, trigger: HTMLElement) => {
    const r = trigger.getBoundingClientRect();
    setFlyoutPos({
      left: r.right + 4,
      // Keep it on screen when a low rail slot is used.
      top: Math.min(r.top, Math.max(8, window.innerHeight - 260)),
    });
    setFlyout(groupId);
  }, []);

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  // Dismiss the flyout on outside press or Escape. Mousedown (not click) so the
  // first click on whatever is underneath isn't swallowed — the same reason
  // ui/context-menu.tsx uses mousedown.
  useEffect(() => {
    if (!flyout) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (railRef.current?.contains(target)) return;
      // Portalled to <body>, so it is not inside railRef — without this a click
      // on a flyout row would dismiss it before the tool was picked.
      if (target.closest?.('[data-tool-flyout]')) return;
      setFlyout(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlyout(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [flyout]);

  const pick = useCallback(
    (toolId: string) => {
      onSelect(toolId);
      setFlyout(null);
    },
    [onSelect]
  );

  return (
    <div
      ref={railRef}
      className="w-[48px] shrink-0 flex flex-col items-center pt-2 gap-1 border-r border-studioBorder bg-newBgColorInner z-30"
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t('designer_tools', 'Tools')}
    >
      {TOOL_GROUPS.map((group) => {
        const tools = visibleTools(group, aiAvailable);
        if (!tools.length) return null;
        const shown = slotTool(group, lastToolPerGroup, aiAvailable);
        const Icon = shown.icon;
        const isActive = tools.some((t2) => t2.id === activeTool);
        const hasFlyout = tools.length > 1;

        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              onClick={() => pick(shown.id)}
              onPointerDown={(e) => {
                if (!hasFlyout) return;
                clearHold();
                const trigger = e.currentTarget as HTMLElement;
                holdTimer.current = setTimeout(() => openFlyout(group.id, trigger), HOLD_MS);
              }}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onContextMenu={(e) => {
                if (!hasFlyout) return;
                e.preventDefault();
                openFlyout(group.id, e.currentTarget as HTMLElement);
              }}
              onKeyDown={(e) => {
                // Keyboard route into the flyout, since hold and right-click
                // are both pointer-only.
                if (hasFlyout && (e.key === 'ArrowRight' || (e.altKey && e.key === 'Enter'))) {
                  e.preventDefault();
                  openFlyout(group.id, e.currentTarget as HTMLElement);
                }
              }}
              aria-label={`${t(shown.labelKey, shown.label)} (${group.shortcut.toUpperCase()})`}
              aria-pressed={isActive}
              aria-haspopup={hasFlyout ? 'menu' : undefined}
              aria-expanded={hasFlyout ? flyout === group.id : undefined}
              data-tooltip-id="tooltip"
              data-tooltip-content={`${t(shown.labelKey, shown.label)} (${group.shortcut.toUpperCase()})`}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
                isActive
                  ? 'bg-designerAccent/20 text-btnPrimaryAccent'
                  : 'text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor'
              }`}
            >
              <Icon size={18} />
              {hasFlyout && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-[3px] inset-e-[3px] w-0 h-0 border-l-4 border-l-transparent border-b-4 border-b-current opacity-70"
                />
              )}
            </button>

            {flyout === group.id && flyoutPos && typeof document !== 'undefined' &&
              createPortal(
              <div
                role="menu"
                tabIndex={-1}
                data-tool-flyout
                aria-label={t('designer_tool_options', 'Tool options')}
                style={{ left: flyoutPos.left, top: flyoutPos.top }}
                // Portalled to <body> rather than positioned inside the rail:
                // the rail sits in a z-30 stacking context, so a z-40 child
                // still loses to the LATER z-30 sibling rail beside it and the
                // flyout was painted over (visibly cut off at its left edge).
                className="fixed z-400 min-w-[212px] py-1 rounded-lg border border-studioBorder bg-newBgColorInner shadow-2xl"
              >
                {tools.map((tool) => {
                  const RowIcon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      role="menuitem"
                      onClick={() => pick(tool.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-start transition-colors ${
                        tool.id === activeTool
                          ? 'bg-designerAccent/20 text-btnPrimaryAccent'
                          : 'text-textColor hover:bg-studioBorder/30'
                      }`}
                    >
                      <RowIcon size={16} className="shrink-0" />
                      <span className="flex-1 truncate">{t(tool.labelKey, tool.label)}</span>
                      <span className="shrink-0 text-[11px] text-textColor/40 uppercase">
                        {group.shortcut}
                      </span>
                    </button>
                  );
                })}
              </div>,
              document.body
            )}
          </div>
        );
      })}
    </div>
  );
};
