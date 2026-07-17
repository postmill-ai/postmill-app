'use client';

import { FC, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

// Shared right-side slide-over. Replaces the four hand-rolled shells (F3) in
// posts.tab and the metric/day/channel drill panels. filter.bar keeps its own
// z-[300] portal (it sits above this layer).

// Module-level stack of open drawer ids. Only the top drawer reacts to Esc and
// runs its Tab focus-trap — `e.stopPropagation()` does NOT stop sibling keydown
// listeners bound to the same `document`, so without this guard one Esc would
// close every stacked drawer at once and the focus traps would fight.
const openDrawerStack: string[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const nodes = Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE)
  ).filter((el) => !el.hasAttribute('disabled'));
  if (!nodes.length) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Overrides Esc handling (e.g. to close an inner drill first). Defaults to onClose. */
  onEscape?: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** Extra classes appended to the sliding panel. */
  panelClassName?: string;
}

export const Drawer: FC<DrawerProps> = ({
  open,
  onClose,
  onEscape,
  children,
  ariaLabel,
  panelClassName,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(onEscape);
  // Keep the latest callbacks in refs — written in an effect (not at render) so
  // the Esc/Tab listener below never re-subscribes when the callbacks change;
  // the keydown handler reads `.current` at event time, so an every-commit sync
  // is enough.
  useEffect(() => {
    onCloseRef.current = onClose;
    onEscapeRef.current = onEscape;
  });
  const drawerId = useId();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    openDrawerStack.push(drawerId);
    const isTop = () =>
      openDrawerStack[openDrawerStack.length - 1] === drawerId;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const enterRaf = requestAnimationFrame(() => setEntered(true));
    const focusRaf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE);
      (focusable || panel).focus();
    });
    const onKey = (e: KeyboardEvent) => {
      // Only the top-of-stack drawer handles keys — see openDrawerStack note.
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        (onEscapeRef.current || onCloseRef.current)();
        return;
      }
      if (e.key === 'Tab') trapFocus(e, panelRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(enterRaf);
      cancelAnimationFrame(focusRaf);
      document.removeEventListener('keydown', onKey);
      const idx = openDrawerStack.lastIndexOf(drawerId);
      if (idx !== -1) openDrawerStack.splice(idx, 1);
      setEntered(false);
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open, drawerId]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={clsx(
          'relative w-full sm:max-w-[520px] bg-newBgColorInner border-l border-newTableBorder h-full overflow-y-auto outline-none',
          'transition-transform duration-300 ease-out will-change-transform',
          entered ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full',
          panelClassName
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
