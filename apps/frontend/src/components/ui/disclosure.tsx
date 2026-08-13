'use client';

import React from 'react';
import { clsx } from 'clsx';
import { ChevronDownIcon } from '@postmill-ai/frontend/components/ui/icons';

/**
 * Controlled disclosure (accordion section): a full-width header button that
 * toggles a collapsible body. Styling is deliberately neutral — call sites
 * pass their own classes for the container, header, and body.
 *
 * The body unmounts when closed, so interactive children must keep their
 * state in the parent if it has to survive a collapse.
 */
export const Disclosure: React.FC<{
  header: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}> = ({ header, open, onToggle, children, className, headerClassName, bodyClassName }) => (
  <div className={className}>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={clsx(
        'w-full flex items-start justify-between gap-2 text-start',
        headerClassName
      )}
    >
      <div className="min-w-0 flex-1">{header}</div>
      <ChevronDownIcon
        size={16}
        rotated={open}
        className="shrink-0 mt-0.5 text-textColor/60"
      />
    </button>
    {open && <div className={bodyClassName}>{children}</div>}
  </div>
);
