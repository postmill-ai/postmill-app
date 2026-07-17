'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { PlatformAvatar as SharedPlatformAvatar } from '@gitroom/frontend/components/shared/platform-avatar';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

const CHANNEL_SELECTOR_THRESHOLD = 4;

const PlatformAvatar: FC<{
  integration: Integrations;
  selected: boolean;
  size?: number;
}> = ({ integration, selected, size = 42 }) => (
  <SharedPlatformAvatar
    picture={integration.picture}
    identifier={integration.identifier}
    selected={selected}
    size={size}
  />
);

// Controlled multi-select channel picker — mirrors the composer's
// PicksSocialsComponent display (overlapping-avatar pill + searchable grouped
// checklist, icon-row when few channels), but wired to the calendar channel
// filter instead of the launch store. The dropdown opens inline (not absolute)
// so it renders correctly inside the filter drawer's scroll container.
// `menuAbsolute` floats the popover (absolute, top-full) instead — for hosts
// like the agent toolbar where an in-flow popover would push the layout.
export const ChannelFilterSelect: FC<{
  integrations: Integrations[];
  selectedIds: string[];
  onToggle: (integration: Integrations) => void;
  menuAbsolute?: boolean;
}> = ({ integrations, selectedIds, onToggle, menuAbsolute = false }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectableIntegrations = useMemo(
    () => integrations.filter((f) => !f.inBetweenSteps && !f.disabled),
    [integrations]
  );

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds]
  );

  const filteredIntegrations = useMemo(() => {
    if (!search.trim()) return selectableIntegrations;
    const q = search.trim().toLowerCase();
    return selectableIntegrations.filter(
      (i) =>
        i.name?.toLowerCase().includes(q) ||
        i.identifier?.toLowerCase().includes(q)
    );
  }, [selectableIntegrations, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Integrations[]>();
    for (const integration of filteredIntegrations) {
      const key = integration.identifier || 'other';
      const list = map.get(key) || [];
      list.push(integration);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredIntegrations]);

  // Click-outside + Escape close, mirroring the composer selector.
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedList = useMemo(
    () =>
      selectableIntegrations.filter((i) => selectedIds.includes(i.id)),
    [selectableIntegrations, selectedIds]
  );

  const useDropdown = selectableIntegrations.length > CHANNEL_SELECTOR_THRESHOLD;

  if (useDropdown) {
    return (
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center gap-[10px] px-[12px] py-[6px] rounded-full border border-newColColor bg-newBgColor hover:bg-boxHover transition-colors"
        >
          <div className="flex -space-x-[10px]">
            {selectedList.slice(0, 4).map((integration) => (
              <div
                key={integration.id}
                className="rounded-full border-[2px] border-newBgColor"
              >
                <PlatformAvatar integration={integration} selected size={28} />
              </div>
            ))}
            {selectedList.length > 4 && (
              <div className="rounded-full border-[2px] border-newBgColor bg-boxHover w-[28px] h-[28px] flex items-center justify-center text-[11px] font-semibold text-textColor">
                +{selectedList.length - 4}
              </div>
            )}
            {selectedList.length === 0 && (
              <div className="text-[13px] text-newTableText">
                {t('all_channels', 'All channels')}
              </div>
            )}
          </div>
          {selectedList.length > 0 && (
            <span className="text-[13px] font-medium text-textColor">
              {selectedList.length}{' '}
              {selectedList.length === 1
                ? t('channel', 'channel')
                : t('channels', 'Channels')}
            </span>
          )}
          <div className="flex-1" />
          <svg
            className={clsx(
              'w-[14px] h-[14px] text-textColor transition-transform',
              open && 'rotate-180'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {open && (
          <div
            role="listbox"
            aria-label={t('channels', 'Channels')}
            className={clsx(
              'w-full max-h-[300px] bg-newBgColor border border-newBorder rounded-[12px] shadow-lg flex flex-col',
              menuAbsolute
                ? 'absolute top-full left-0 mt-[8px] z-[50]'
                : 'mt-[8px]'
            )}
          >
            <div className="p-[12px] border-b border-newBorder">
              <div className="relative">
                <svg
                  className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[16px] h-[16px] text-newTextColor/60"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
                  />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('search_channels', 'Search channels...')}
                  className="w-full h-[40px] pl-[38px] pr-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-[8px]">
              {filteredIntegrations.length === 0 && (
                <div className="text-[13px] text-newTableText text-center py-[16px]">
                  {t('no_channels_found', 'No channels found')}
                </div>
              )}
              {grouped.map(([platform, items]) => (
                <div key={platform} className="mb-[8px]">
                  <div className="sticky top-0 bg-newBgColor text-[11px] uppercase tracking-wider text-newTableText px-[8px] py-[4px] z-[1]">
                    {platform}
                  </div>
                  <div className="flex flex-col gap-[2px]">
                    {items.map((integration) => {
                      const selected = isSelected(integration.id);
                      return (
                        <button
                          key={integration.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => onToggle(integration)}
                          className={clsx(
                            'flex items-center gap-[10px] w-full px-[8px] py-[8px] rounded-[8px] text-left transition-colors',
                            selected
                              ? 'bg-[#2B5CD3]/15 text-textColor'
                              : 'hover:bg-boxHover text-textColor'
                          )}
                        >
                          <div
                            className={clsx(
                              'w-[18px] h-[18px] rounded-[4px] border flex items-center justify-center shrink-0',
                              selected
                                ? 'bg-[#2B5CD3] border-[#2B5CD3]'
                                : 'border-newColColor'
                            )}
                          >
                            {selected && (
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M5 12l5 5L20 7" />
                              </svg>
                            )}
                          </div>
                          <PlatformAvatar
                            integration={integration}
                            selected={false}
                            size={28}
                          />
                          <span className="flex-1 text-[13px] truncate">
                            {integration.name}
                          </span>
                          <SafeImage
                            src={`/icons/platforms/${integration.identifier}.png`}
                            className="rounded-[4px] min-w-[16px] min-h-[16px]"
                            alt={integration.identifier}
                            width={16}
                            height={16}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Icon-row mode (≤4 selectable integrations)
  return (
    <div className="flex flex-wrap gap-[12px]">
      {selectableIntegrations.map((integration) => {
        const selected = isSelected(integration.id);
        return (
          <div
            key={integration.id}
            data-tooltip-id="tooltip"
            data-tooltip-content={integration.name}
            onClick={() => onToggle(integration)}
            className={clsx(
              'cursor-pointer border-[2px] relative rounded-full flex justify-center items-center bg-newTableHeader filter transition-all duration-500',
              selected ? 'border-[#622FF6]' : 'grayscale border-transparent'
            )}
          >
            <PlatformAvatar integration={integration} selected={selected} />
          </div>
        );
      })}
    </div>
  );
};
