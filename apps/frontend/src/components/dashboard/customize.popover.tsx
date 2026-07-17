'use client';

import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useDashboardPrefs } from './hooks/useDashboardPrefs';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface DashboardSectionMeta {
  id: string;
  label: string;
  permission?: [string, string];
}

export interface CustomizePopoverProps {
  sections: DashboardSectionMeta[];
}

const GearIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
    <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const Toggle: FC<{ checked: boolean; onChange: () => void; label: ReactNode }> = ({
  checked,
  onChange,
  label,
}) => {
  return (
    <label className="flex items-center justify-between gap-[12px] py-[8px] cursor-pointer group">
      <span className="text-[13px] text-textColor">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={[
          'relative w-[36px] h-[20px] rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-btnPrimary/40',
          checked ? 'bg-btnPrimary' : 'bg-newTableBorder',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full transition-transform',
            checked ? 'translate-x-[16px]' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </label>
  );
};

/**
 * Section visibility popover.
 *
 * - Lists every section the current user is allowed to see (no permission or
 *   the required RBAC permission).
 * - Optimistically shows sections while permissions are loading; only hides
 *   them once the permission set resolves and the check fails.
 * - Toggling a section writes `{ hidden: string[], v:1 }` to
 *   `localStorage['dashboard_prefs']`.
 * - IDs already stored in `dashboard_prefs.hidden` that are not present in the
 *   supplied `sections` prop are ignored by `useDashboardPrefs` (they are kept
 *   in storage but do not affect any known section).
 */
export const CustomizePopover: FC<CustomizePopoverProps> = ({ sections }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { hidden, toggle } = useDashboardPrefs();
  const permissions = usePermissions();
  const t = useT();

  const visibleSections = sections.filter((section) => {
    if (!section.permission) return true;
    // Optimistic: show while permissions are still loading.
    if (!permissions.isResolved) return true;
    return permissions.hasPermission(...section.permission);
  });

  const handleToggle = useCallback(
    (id: string) => {
      toggle(id);
    },
    [toggle]
  );

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="relative inline-flex">
      <span ref={buttonRef} className="inline-flex">
        <Button
          secondary
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={t('customize_dashboard', 'Customize dashboard')}
          className="px-[10px]"
        >
          <GearIcon className="w-[18px] h-[18px]" />
        </Button>
      </span>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-[8px] z-50 w-[260px] bg-newBgColorInner border border-newTableBorder rounded-[12px] shadow-lg p-[12px]"
        >
          <div className="flex items-center justify-between pb-[8px] mb-[4px] border-b border-newTableBorder">
            <span className="text-[13px] font-medium text-newTableText">
              {t('customize', 'Customize')}
            </span>
          </div>

          {visibleSections.length === 0 ? (
            <p className="text-[12px] text-newTableText py-[8px]">
              {t('no_sections_available', 'No sections available.')}
            </p>
          ) : (
            <div className="flex flex-col">
              {visibleSections.map((section) => (
                <Toggle
                  key={section.id}
                  checked={!hidden.includes(section.id)}
                  onChange={() => handleToggle(section.id)}
                  label={section.label}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
