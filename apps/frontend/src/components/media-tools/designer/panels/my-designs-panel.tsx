'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useDebounce } from 'use-debounce';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { Button } from '@postmill-ai/react/form/button';
import { UtcToLocalDateRender } from '@postmill-ai/react/helpers/utc.date.render';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerGallerySort } from '@postmill-ai/nestjs-libraries/media/designer-doc/template-category';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { DesignPreviewImage } from './design-preview-image';
import { DesignerGalleryToolbar } from './gallery-toolbar';
import { designerGalleryGridStyle, useDesignerGallerySize } from './gallery-preferences';
import { GalleryCardActions, GalleryPreviewFallback } from './gallery-card';

export interface MyDesign {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  previewUrl?: string | null;
  previewDataUrl?: string | null;
  mode?: 'image' | 'video';
}

interface DesignPage {
  designs: MyDesign[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_LIMIT = 24;

export const MyDesignsPanel: FC<{
  onOpen: (design: MyDesign) => void | Promise<void>;
  onClose?: () => void;
}> = ({ onOpen, onClose }) => {
  const user = useUser();
  const t = useT();
  const [search, setSearch] = useState('');
  const [query] = useDebounce(search.trim(), 250);
  const [sort, setSort] = useState<DesignerGallerySort>('newest');
  const { size, setSize } = useDesignerGallerySize(user.orgId);

  return (
    <div className="flex flex-col gap-[12px] p-1">
      <DesignerGalleryToolbar
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        size={size}
        onSizeChange={setSize}
        searchLabel={t('my_designs_panel_search', 'Search designs')}
        searchPlaceholder={t('my_designs_panel_search_placeholder', 'Search designs...')}
      />
      <DesignResults
        key={`${user.orgId}:${query}:${sort}`}
        query={query}
        sort={sort}
        size={size}
        onOpen={onOpen}
        onClose={onClose}
      />
    </div>
  );
};

const DesignResults: FC<{
  query: string;
  sort: DesignerGallerySort;
  size: 's' | 'm' | 'l';
  onOpen: (design: MyDesign) => void | Promise<void>;
  onClose?: () => void;
}> = ({ query, sort, size, onOpen, onClose }) => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const decision = useDecisionModal();
  const getKey = useCallback((pageIndex: number, previousPage: DesignPage | null) => {
    if (previousPage && previousPage.designs.length === 0) return null;
    const params = new URLSearchParams({
      page: String(pageIndex + 1),
      limit: String(PAGE_LIMIT),
      sort,
    });
    if (query) params.set('query', query);
    return `/media/designs?${params.toString()}`;
  }, [query, sort]);
  const { data, error, isLoading, isValidating, size: pageCount, setSize, mutate } =
    useSWRInfinite<DesignPage>(getKey, async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load designs');
      return res.json() as Promise<DesignPage>;
    }, { revalidateOnFocus: false, revalidateFirstPage: false });

  const designs = useMemo(() => {
    const byId = new Map<string, MyDesign>();
    for (const page of data || []) {
      for (const design of page.designs) byId.set(design.id, design);
    }
    return [...byId.values()];
  }, [data]);
  const lastPage = data?.[data.length - 1];
  const hasMore = !!lastPage && lastPage.designs.length === PAGE_LIMIT &&
    pageCount * PAGE_LIMIT < (data?.[0]?.total || 0);
  const loadingMore = isValidating && pageCount > (data?.length || 0);

  const handleDelete = useCallback(async (design: MyDesign) => {
    const approved = await decision.open({
      title: t('my_designs_panel_delete_title', 'Delete design?'),
      description: t(
        'my_designs_panel_delete_description',
        'This will permanently delete "{{name}}".',
        { name: design.name, interpolation: { escapeValue: false } },
      ),
      approveLabel: t('delete', 'Delete'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    const response = await fetch(`/media/designs/${design.id}`, { method: 'DELETE' });
    if (response.ok) await mutate();
  }, [decision, fetch, mutate, t]);

  if (isLoading && !data) {
    return <PanelSkeletonGrid count={10} columnsClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />;
  }
  if (error && !data) {
    return <PanelError message={t('my_designs_panel_failed_to_load', 'Failed to load designs')} onRetry={() => mutate()} />;
  }
  if (!designs.length) {
    return (
      <div className="py-8 text-center text-[12px] text-newTextColor/60">
        {query
          ? t('my_designs_panel_no_search_results', 'No designs match “{{query}}”.', { query, interpolation: { escapeValue: false } })
          : t('my_designs_panel_no_designs_yet', 'No designs yet. Start one from a format or template!')}
      </div>
    );
  }

  return (
    <>
      {error && (
        <div role="alert" className="text-[12px] text-dangerText">
          {t('gallery_refresh_failed', 'Some results could not be refreshed. Try again.')}
        </div>
      )}
      <div className="grid gap-[10px]" style={designerGalleryGridStyle(size)} role="list">
        {designs.map((design) => (
          <article
            key={design.id}
            role="listitem"
            data-design-id={design.id}
            className="group min-w-0 overflow-hidden rounded-[8px] border border-studioBorder bg-newBgColorInner transition-colors hover:border-designerAccent/60"
          >
            <div className="relative aspect-[4/3] bg-studioBorder/10">
              <DesignPreviewImage
                src={design.previewUrl || design.previewDataUrl}
                alt={t('gallery_design_preview', '{{name}} preview', { name: design.name, interpolation: { escapeValue: false } })}
                className="h-full w-full object-cover"
                fallback={<GalleryPreviewFallback />}
              />
              <span className="absolute start-[6px] top-[6px] rounded-full bg-newBgColorInner/90 px-[6px] py-[3px] text-[9px] font-[500] leading-none text-btnPrimaryAccent">
                {design.mode === 'video'
                  ? t('my_designs_panel_video_badge', 'VIDEO')
                  : t('my_designs_panel_image_badge', 'IMAGE')}
              </span>
              <GalleryCardActions
                primaryLabel={t('open', 'Open')}
                primaryAriaLabel={t('my_designs_panel_open_design', 'Open {{name}}', { name: design.name, interpolation: { escapeValue: false } })}
                onPrimary={async () => {
                  await onOpen(design);
                  onClose?.();
                }}
              />
              <Button
                danger
                aria-label={t('my_designs_panel_delete_design', 'Delete {{name}}', { name: design.name, interpolation: { escapeValue: false } })}
                onClick={() => handleDelete(design)}
                className="absolute end-[6px] top-[6px] z-10 h-[26px] w-[26px] px-0 text-[13px] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              >
                ×
              </Button>
            </div>
            <div className="p-[8px]">
              <div
                className="truncate text-[11px] font-[500] text-textColor"
                title={design.name}
                data-tooltip-id="tooltip"
                data-tooltip-content={design.name}
              >
                {design.name}
              </div>
              <div className="mt-[2px] text-[10px] text-newTableText">
                <UtcToLocalDateRender date={design.updatedAt} format="MMM D, YYYY" />
              </div>
            </div>
          </article>
        ))}
      </div>
      {hasMore && (
        <Button secondary loading={loadingMore} onClick={() => setSize((current) => current + 1)} className="self-center">
          {t('my_designs_panel_load_more', 'Load more')}
        </Button>
      )}
    </>
  );
};
