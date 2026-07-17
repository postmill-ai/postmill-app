'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import useCookie from 'react-use-cookie';
import { DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';

// A single row inside a ToolbarDropdown. It renders one of the existing composer
// toolbar icon-buttons (`children`) unchanged — the `.tb-menu-item` rule in
// global.scss stretches that button's clickable box to fill the row, and the
// label below is overlaid with pointer-events-none so clicking anywhere on the
// row hits the button's native handler. Set `nested` for buttons wrapped in a
// `<div className="relative">` (all the AI buttons), whose clickable box sits
// one level deeper.
export const MenuItem: FC<{
  label: string;
  nested?: boolean;
  children: ReactNode;
}> = ({ label, nested, children }) => {
  return (
    <div
      className="tb-menu-item rounded-[6px] hover:bg-newBgColor"
      data-nested={nested ? 'true' : undefined}
    >
      {children}
      <span className="absolute start-[40px] top-1/2 -translate-y-1/2 pointer-events-none text-[13px] font-[500] text-textColor whitespace-nowrap">
        {label}
      </span>
    </div>
  );
};

// A compact toolbar pill that collapses a group of buttons into an upward-opening
// popover (matches the Insert Media / Design Media pill styling). Used to group
// the AI tools and the text-formatting buttons so the composer toolbar stops
// wrapping into multiple ragged rows on narrow widths.
const MENU_WIDTH = 210;

export const ToolbarDropdown: FC<{
  label: string;
  icon: ReactNode;
  children: ReactNode;
}> = ({ label, icon, children }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  // Portaled to <body>, outside the app's `.dark`/`.light` theme wrapper, so
  // stamp the current mode onto the popover for the CSS vars to resolve.
  const [mode] = useCookie('mode', 'dark');
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // The toolbar row is a horizontal-scroll container (overflow-x forces
  // overflow-y:auto), which would clip an in-flow popover. Portal it to <body>
  // with fixed positioning above the trigger so no ancestor overflow clips it.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)
    );
    setPos({ left, bottom: window.innerHeight - r.top + 8 });
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) place();
      return !o;
    });
  }, [place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  return (
    <div ref={triggerRef} className="relative shrink-0">
      <div
        onClick={toggle}
        className={clsx(
          'cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex px-[8px] gap-[6px] select-none',
          open ? 'bg-newBgColor' : 'bg-newColColor'
        )}
      >
        <div className="flex items-center">{icon}</div>
        <div className="text-[10px] font-[600] whitespace-nowrap">{label}</div>
        <DropdownArrowIcon rotated={open} />
      </div>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              left: pos.left,
              bottom: pos.bottom,
              width: MENU_WIDTH,
            }}
            className={clsx(
              mode,
              'z-[400] bg-newBgColorInner text-textColor menu-shadow rounded-[8px] p-[6px] flex flex-col gap-[1px]'
            )}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
};

export const SparkleIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
      fill="currentColor"
    />
    <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" fill="currentColor" />
  </svg>
);

export const FormatIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M4 20l5-14h1l5 14M6 15h6M15 20h5M17.5 12l2-6h.5l2 6M18 17h4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
