'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useBrands, type Brand } from '@gitroom/frontend/components/settings/brand/use-brands';

// The Brands list (former BrandTab list view). "Edit" now navigates to the brand-edit route
// (/settings/ai/brands/[id]/voice) instead of flipping in-page state.
export const BrandList = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const router = useRouter();
  const { data: brands, isLoading, mutate: refetchBrands } = useBrands();

  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      toaster.show(t('name_required', 'Name is required'), 'warning');
      return;
    }
    const res = await fetch('/brands', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      toaster.show(t('create_failed', 'Failed to create brand'), 'warning');
      return;
    }
    setNewName('');
    setShowCreate(false);
    refetchBrands();
    toaster.show(t('brand_created', 'Brand created'), 'success');
  }, [newName, fetch, toaster, t, refetchBrands]);

  const handleDelete = useCallback(
    async (brand: Brand) => {
      if (!(await deleteDialog(t('confirm_delete_brand', 'Delete "{{name}}"?', { name: brand.name }))))
        return;
      const res = await fetch(`/brands/${brand.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toaster.show(t('delete_failed', 'Failed to delete brand'), 'warning');
        return;
      }
      refetchBrands();
      toaster.show(t('brand_deleted', 'Brand deleted'), 'success');
    },
    [fetch, toaster, t, refetchBrands]
  );

  const handleSetDefault = useCallback(
    async (brand: Brand) => {
      const res = await fetch(`/brands/${brand.id}/default`, { method: 'POST' });
      if (!res.ok) {
        toaster.show(t('set_default_failed', 'Failed to set default'), 'warning');
        return;
      }
      refetchBrands();
      toaster.show(t('default_set', 'Default brand updated'), 'success');
    },
    [fetch, toaster, t, refetchBrands]
  );

  if (isLoading) {
    return (
      <div className="my-[16px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px]">
        <div className="animate-pulse">{t('loading', 'Loading')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-[16px] mb-[16px]">
        <div className="flex flex-col gap-[4px]">
          <h3 className="text-[18px] font-semibold text-textColor">{t('brands', 'Brands')}</h3>
          <p className="text-[13px] text-newTableText max-w-[640px]">
            {t(
              'brands_description',
              'Create AI personalities for your brand — set how it writes, what it looks like, and what it knows — so every post sounds on-brand.'
            )}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[14px] hover:opacity-90 shrink-0"
        >
          {t('create_brand', 'Create Brand')}
        </button>
      </div>

      {showCreate && (
        <div className="flex gap-[8px] mb-[16px]">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('brand_name_placeholder', 'Brand name...')}
            className="bg-newBgColor border border-newTableBorder rounded-[4px] px-[12px] py-[8px] text-textColor text-[14px] outline-none flex-1"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[14px] hover:opacity-90"
          >
            {t('save', 'Save')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-[8px]">
        {(!brands || brands.length === 0) && (
          <div className="text-newTableText text-[14px] py-[24px] text-center">
            {t('no_brands_yet', 'No brands yet. Create your first brand to define your brand voice.')}
          </div>
        )}
        {brands?.map((brand) => (
          <div
            key={brand.id}
            className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px] flex items-center gap-[16px]"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-[8px]">
                <div className="text-[14px] font-[500]">{brand.name}</div>
                {brand.isDefault && (
                  <div className="bg-btnPrimary text-white text-[10px] rounded-[4px] px-[6px] py-[2px] uppercase">
                    {t('default', 'Default')}
                  </div>
                )}
                {!brand.enabled && (
                  <div className="bg-red-500/20 text-red-700 dark:text-red-400 text-[10px] rounded-[4px] px-[6px] py-[2px]">
                    {t('disabled', 'Disabled')}
                  </div>
                )}
              </div>
              {brand.palette?.length || brand.assets?.length ? (
                <div className="flex items-center gap-[10px] mt-[6px]">
                  {!!brand.palette?.length && (
                    <div className="flex items-center -space-x-[4px]">
                      {brand.palette.slice(0, 6).map((c, i) => (
                        <div
                          key={`${c}-${i}`}
                          className="w-[14px] h-[14px] rounded-full border border-newTableBorder"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  )}
                  {!!brand.assets?.length && (
                    <span className="text-[11px] text-newTableText">
                      {brand.assets.length}{' '}
                      {brand.assets.length === 1 ? t('asset', 'asset') : t('assets_lower', 'assets')}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-[8px]">
              {!brand.isDefault && (
                <button
                  onClick={() => handleSetDefault(brand)}
                  className="text-[12px] text-newTableText hover:text-textColor"
                >
                  {t('set_default', 'Set as Default')}
                </button>
              )}
              <button
                onClick={() => router.push(`/settings/ai/brands/${brand.id}/voice`)}
                className="text-btnPrimaryAccent text-[12px] hover:underline"
              >
                {t('edit', 'Edit')}
              </button>
              <button
                onClick={() => handleDelete(brand)}
                className="text-red-600 dark:text-red-500 text-[12px] hover:underline"
              >
                {t('delete', 'Delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
