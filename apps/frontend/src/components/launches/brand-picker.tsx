'use client';

import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useClickOutside } from '@mantine/hooks';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';

interface Brand {
  id: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
}

const useBrands = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/brands');
    if (!res.ok) return [];
    return res.json();
  }, [fetch]);
  return useSWR<Brand[]>('brands-list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};

// Matches the composer footer's other selectors (RepeatComponent / TagsComponent):
// a bordered pill with an icon + label + dropdown arrow, and a menu-shadow popover.
export const BrandPicker = () => {
  const t = useT();
  const { data: brands, isLoading } = useBrands();
  const brandId = useLaunchStore((state) => state.brandId);
  const setBrandId = useLaunchStore((state) => state.setBrandId);
  const [isOpen, setIsOpen] = useState(false);

  const ref = useClickOutside(() => {
    if (!isOpen) return;
    setIsOpen(false);
  });

  const selectedBrand = useMemo(
    () => brands?.find((b) => b.id === brandId),
    [brands, brandId]
  );

  if (isLoading || !brands?.length) return null;

  const select = (id: string | null) => {
    setBrandId(id);
    setIsOpen(false);
  };

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
        className="px-[12px] lg:px-[16px] justify-center flex gap-[8px] items-center h-full select-none flex-1 cursor-pointer bg-transparent border-none text-textColor"
      >
        <div>
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
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
          </svg>
        </div>
        <div className="max-w-[160px] truncate whitespace-nowrap">
          {selectedBrand
            ? selectedBrand.isDefault
              ? t('brand_name_default', '{{name}} (Default)', {
                  name: selectedBrand.name,
                })
              : selectedBrand.name
            : t('brand', 'Brand')}
        </div>
        <div>
          <DropdownArrowIcon rotated={isOpen} />
        </div>
      </button>
      {isOpen && (
        <ul className="z-[300] absolute start-0 bottom-[100%] w-[240px] bg-newBgColorInner p-[12px] menu-shadow -translate-y-[10px] flex flex-col list-none m-0">
          <li className="m-0 p-0">
            <button
              type="button"
              onClick={() => select(null)}
              className={clsx(
                'w-full text-left h-[40px] py-[8px] px-[20px] -mx-[12px] hover:bg-newBgColor cursor-pointer flex items-center bg-transparent border-none text-textColor',
                !brandId && 'text-btnPrimaryAccent'
              )}
            >
              {t('no_brand', 'No Brand')}
            </button>
          </li>
          {brands.map((brand) => (
            <li key={brand.id} className="m-0 p-0">
              <button
                type="button"
                onClick={() => select(brand.id)}
                className={clsx(
                  'w-full text-left h-[40px] py-[8px] px-[20px] -mx-[12px] hover:bg-newBgColor cursor-pointer flex items-center bg-transparent border-none text-textColor',
                  brandId === brand.id && 'text-btnPrimaryAccent'
                )}
              >
                <span className="truncate">
                  {brand.isDefault
                    ? t('brand_name_default', '{{name}} (Default)', {
                        name: brand.name,
                      })
                    : brand.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
