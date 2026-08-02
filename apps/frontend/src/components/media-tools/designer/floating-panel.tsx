'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * A movable, height-resizable floating window for the Designer.
 *
 * There is no floating-window component or drag library in the repo, so this is
 * bespoke: pointer capture for the drag (the pattern used by the focal-point
 * picker in `panels/image-inspector.tsx` — no manual window listeners to leak,
 * and pointer-leave is handled for us) plus edge clamping modelled on
 * `components/ui/context-menu.tsx`.
 *
 * It positions itself absolutely inside its nearest positioned ancestor, which
 * in the Designer is the editor row — so it can roam over the rail, panels and
 * canvas but can never cover the video timeline or output tabs below them.
 */

export interface FloatingPanelPosition {
  x: number;
  y: number;
  height: number;
}

interface FloatingPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Fixed panel width in px. */
  width?: number;
  position: FloatingPanelPosition;
  onPositionChange: (next: FloatingPanelPosition) => void;
  minHeight?: number;
  maxHeight?: number;
}

const MARGIN = 8;

export const FloatingPanel: FC<FloatingPanelProps> = ({
  title,
  onClose,
  children,
  width = 260,
  position,
  onPositionChange,
  minHeight = 160,
  maxHeight = 720,
}) => {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  // Pointer offset within the title bar at grab time, so the panel doesn't jump
  // its top-left corner to the cursor.
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStart = useRef<{ y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const bounds = useCallback(() => {
    const parent = panelRef.current?.offsetParent as HTMLElement | null;
    return {
      w: parent?.clientWidth ?? window.innerWidth,
      h: parent?.clientHeight ?? window.innerHeight,
    };
  }, []);

  const clamp = useCallback(
    (next: FloatingPanelPosition): FloatingPanelPosition => {
      const { w, h } = bounds();
      const height = Math.max(
        minHeight,
        Math.min(next.height, maxHeight, h - MARGIN * 2)
      );
      return {
        x: Math.max(MARGIN, Math.min(next.x, w - width - MARGIN)),
        y: Math.max(MARGIN, Math.min(next.y, h - height - MARGIN)),
        height,
      };
    },
    [bounds, width, minHeight, maxHeight]
  );

  // A restored position can land off-screen if the window shrank since it was
  // saved, so clamp on mount and whenever the editor is resized. Re-running on
  // `position` is safe: clamping an already-clamped value is a no-op, and the
  // equality guard stops the update loop there.
  useLayoutEffect(() => {
    const next = clamp(position);
    if (
      next.x !== position.x ||
      next.y !== position.y ||
      next.height !== position.height
    ) {
      onPositionChange(next);
    }
  }, [clamp, position, onPositionChange]);

  useEffect(() => {
    const onResize = () => onPositionChange(clamp(position));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp, position, onPositionChange]);

  const onDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Let the close button work — it lives inside the drag handle.
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOffset.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
    setDragging(true);
  };

  const onDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragOffset.current) return;
    onPositionChange(
      clamp({
        x: e.clientX - dragOffset.current.dx,
        y: e.clientY - dragOffset.current.dy,
        height: position.height,
      })
    );
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragOffset.current = null;
    setDragging(false);
  };

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStart.current = { y: e.clientY, height: position.height };
    setResizing(true);
  };

  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing || !resizeStart.current) return;
    onPositionChange(
      clamp({
        x: position.x,
        y: position.y,
        height: resizeStart.current.height + (e.clientY - resizeStart.current.y),
      })
    );
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    resizeStart.current = null;
    setResizing(false);
  };

  // Keyboard move/resize, so the panel isn't pointer-only.
  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    onPositionChange(
      clamp({ x: position.x + delta[0], y: position.y + delta[1], height: position.height })
    );
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      style={{ left: position.x, top: position.y, width, height: position.height }}
      // z-40 sits above the side panel and inspector (z-20) and the rail (z-30),
      // below the collaboration cursors (z-50) and context menus.
      className="absolute z-40 flex flex-col rounded-xl border border-studioBorder bg-newBgColorInner shadow-2xl overflow-hidden"
    >
      <div
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onHandleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={t('designer_move_panel', 'Move {{title}} panel', { title })}
        className={`flex items-center gap-2 px-3 py-2 border-b border-studioBorder shrink-0 select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider flex-1 truncate">
          {title}
        </span>
        <button
          type="button"
          data-no-drag
          onClick={onClose}
          aria-label={t('close', 'Close')}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-textColor/60 hover:bg-studioBorder/40 hover:text-textColor transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">{children}</div>

      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        role="separator"
        aria-label={t('designer_resize_panel', 'Resize {{title}} panel', { title })}
        aria-orientation="horizontal"
        className={`h-2 shrink-0 cursor-ns-resize flex items-center justify-center group ${
          resizing ? 'bg-studioBorder/40' : 'hover:bg-studioBorder/30'
        }`}
      >
        <span className="w-8 h-[2px] rounded-full bg-studioBorder group-hover:bg-designerAccent/60" />
      </div>
    </div>
  );
};
