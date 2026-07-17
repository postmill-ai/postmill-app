'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useClickOutside } from '@mantine/hooks';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';

interface ShortlinkProvider {
  identifier: string;
  name: string;
  customDomain: string;
  version: string;
}

interface ShortlinkProvidersResponse {
  providers: ShortlinkProvider[];
  activeIdentifier: string | null;
}

const useShortlinkProviders = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/posts/shortlink-providers');
    if (!res.ok) return { providers: [], activeIdentifier: null };
    return res.json();
  }, [fetch]);
  return useSWR<ShortlinkProvidersResponse>('composer-shortlink-providers', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};

const LinkIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

// Composer footer short-link provider selector — matches the RepeatComponent /
// BrandPicker pill family. Selecting a provider makes it the org's active
// short-link provider (org-wide); "No short links" turns shortening off for the
// post via the parent's `enabled` flag.
export const ShortlinkPicker: FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}> = ({ enabled, onChange }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, isLoading, mutate } = useShortlinkProviders();
  const [isOpen, setIsOpen] = useState(false);

  const ref = useClickOutside(() => {
    if (!isOpen) return;
    setIsOpen(false);
  });

  const providers = useMemo(() => data?.providers || [], [data?.providers]);
  const activeIdentifier = data?.activeIdentifier || null;

  const activeProvider = useMemo(
    () => providers.find((p) => p.identifier === activeIdentifier),
    [providers, activeIdentifier]
  );

  const activate = useCallback(
    async (identifier: string) => {
      if (identifier !== activeIdentifier) {
        const res = await fetch('/posts/shortlink-active', {
          method: 'POST',
          body: JSON.stringify({ identifier }),
        });
        if (!res.ok) {
          toaster.show(
            t('could_not_activate_shortlink', 'Could not activate provider'),
            'warning'
          );
          return;
        }
        await mutate();
      }
      onChange(true);
      setIsOpen(false);
    },
    [activeIdentifier, fetch, toaster, t, mutate, onChange]
  );

  if (isLoading) return null;

  // No configured provider → discoverable "connect" pill (always visible).
  if (!providers.length) {
    return (
      <a
        href="/settings/shortlinks"
        data-tooltip-id="tooltip"
        data-tooltip-content={t(
          'connect_shortlink_provider',
          'Connect a short-link provider to track clicks'
        )}
        className="border rounded-[8px] border-newTextColor/10 h-[36px] lg:h-[44px] px-[12px] lg:px-[16px] flex items-center gap-[8px] text-[13px] lg:text-[15px] font-[600] text-btnPrimary select-none"
      >
        <LinkIcon />
        {t('connect_shortlink', 'Connect short-link')}
      </a>
    );
  }

  const label =
    enabled && activeProvider
      ? activeProvider.customDomain || activeProvider.name
      : t('no_short_links', 'No short links');

  return (
    <div
      ref={ref}
      className={clsx(
        'border rounded-[8px] justify-center flex items-center relative h-[36px] lg:h-[44px] text-[13px] lg:text-[15px] font-[600] select-none',
        isOpen ? 'border-[#2B5CD3]' : 'border-newTextColor/10'
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-[12px] lg:px-[16px] justify-center flex gap-[8px] items-center h-full select-none flex-1 cursor-pointer border-0 p-0 bg-transparent"
      >
        <div className={clsx('cursor-pointer', enabled && 'text-btnPrimaryAccent')}>
          <LinkIcon />
        </div>
        <div className="cursor-pointer max-w-[160px] truncate whitespace-nowrap">
          {label}
        </div>
        <div className="cursor-pointer">
          <DropdownArrowIcon rotated={isOpen} />
        </div>
      </button>
      {isOpen && (
        <div className="z-[300] absolute start-0 bottom-[100%] w-[240px] bg-newBgColorInner p-[12px] menu-shadow -translate-y-[10px] flex flex-col">
          <button
            type="button"
            onClick={() => {
              onChange(false);
              setIsOpen(false);
            }}
            className={clsx(
              'h-[40px] py-[8px] px-[20px] -mx-[12px] hover:bg-newBgColor cursor-pointer flex items-center border-0 bg-transparent text-left',
              !enabled && 'text-btnPrimaryAccent'
            )}
          >
            {t('no_short_links', 'No short links')}
          </button>
          {providers.map((provider) => {
            const selected = enabled && provider.identifier === activeIdentifier;
            return (
              <button
                type="button"
                key={provider.identifier}
                onClick={() => activate(provider.identifier)}
                className={clsx(
                  'h-[40px] py-[8px] px-[20px] -mx-[12px] hover:bg-newBgColor cursor-pointer flex flex-col justify-center border-0 bg-transparent text-left',
                  selected && 'text-btnPrimaryAccent'
                )}
              >
                <span className="truncate">{provider.name}</span>
                {provider.customDomain ? (
                  <span className="text-[11px] text-newTableText truncate">
                    {provider.customDomain}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
