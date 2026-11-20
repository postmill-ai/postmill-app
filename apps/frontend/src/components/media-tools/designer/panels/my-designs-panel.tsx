'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
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

interface DesignBatchSummary {
  id: string;
  name: string;
  sourceName?: string | null;
  updatedAt: string;
  count: number;
  previewUrl?: string | null;
}

interface MyDesignsPanelProps {
  onOpen: (design: MyDesign) => void | Promise<void>;
  onClose?: () => void;
  initialBatchId?: string;
  imageOnly?: boolean;
}

const PAGE_LIMIT = 24;

export const MyDesignsPanel: FC<MyDesignsPanelProps> = ({ onOpen, onClose, initialBatchId, imageOnly = false }) => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const decision = useDecisionModal();
  const [search, setSearch] = useState('');
  const [query] = useDebounce(search.trim(), 250);
  const [sort, setSort] = useState<DesignerGallerySort>('newest');
  const { size, setSize } = useDesignerGallerySize(user.orgId);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(initialBatchId || null);
  const [extraDesigns, setExtraDesigns] = useState<MyDesign[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [extraBatches, setExtraBatches] = useState<DesignBatchSummary[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [loadingMoreBatches, setLoadingMoreBatches] = useState(false);

  const designsUrl = useCallback((pageNumber: number) => {
    const params = new URLSearchParams({
      page: String(pageNumber),
      limit: String(PAGE_LIMIT),
      group: 'root',
      sort,
    });
    if (query) params.set('query', query);
    return `/media/designs?${params.toString()}`;
  }, [query, sort]);

  const { data, error, isLoading, mutate } = useSWR(
    `${user.orgId}:${designsUrl(1)}`,
    async () => {
      const res = await fetch(designsUrl(1));
      if (!res.ok) throw new Error('Failed to load designs');
      return res.json();
    },
    { keepPreviousData: true }
  );
  const {
    data: batchData,
    error: batchError,
    isLoading: batchesLoading,
    mutate: mutateBatches,
  } = useSWR(
    `my-design-batches-${user.orgId}`,
    async () => {
      const res = await fetch(`/media/designs/batches?page=1&limit=${PAGE_LIMIT}`);
      if (!res.ok) throw new Error('Failed to load design batches');
      return res.json();
    },
    { keepPreviousData: true }
  );
  const {
    data: activeBatch,
    error: activeBatchError,
    isLoading: activeBatchLoading,
    mutate: mutateActiveBatch,
  } = useSWR(
    selectedBatchId ? `my-design-batch-${user.orgId}-${selectedBatchId}` : null,
    async () => {
      const res = await fetch(`/media/designs/batches/${selectedBatchId}`);
      if (!res.ok) throw new Error('Failed to load design batch');
      return res.json();
    }
  );

  useEffect(() => {
    setExtraDesigns([]);
    setPage(1);
    setExtraBatches([]);
    setBatchPage(1);
    setSelectedBatchId(initialBatchId || null);
  }, [user.orgId, initialBatchId, query, sort]);

  const loadedDesigns: MyDesign[] = useMemo(() => {
    const seen = new Map<string, MyDesign>();
    for (const design of [...(data?.designs || []), ...extraDesigns]) {
      seen.set(design.id, design);
    }
    return [...seen.values()];
  }, [data, extraDesigns]);
  const designs = useMemo(
    () => imageOnly ? loadedDesigns.filter((design) => design.mode !== 'video') : loadedDesigns,
    [imageOnly, loadedDesigns]
  );
  const total: number = data?.total ?? loadedDesigns.length;
  const hasMore = loadedDesigns.length < total;

  const batches: DesignBatchSummary[] = useMemo(() => {
    const seen = new Map<string, DesignBatchSummary>();
    for (const batch of [...(batchData?.batches || []), ...extraBatches]) {
      seen.set(batch.id, batch);
    }
    return [...seen.values()];
  }, [batchData, extraBatches]);
  const batchTotal: number = batchData?.total ?? batches.length;
  const hasMoreBatches = batches.length < batchTotal;

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await fetch(designsUrl(next));
      if (!res.ok) return;
      const json = await res.json();
      setExtraDesigns((current) => [...current, ...((json?.designs || []) as MyDesign[])]);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  }, [designsUrl, fetch, page]);

  const loadMoreBatches = useCallback(async () => {
    setLoadingMoreBatches(true);
    try {
      const next = batchPage + 1;
      const res = await fetch(`/media/designs/batches?page=${next}&limit=${PAGE_LIMIT}`);
      if (!res.ok) return;
      const json = await res.json();
      setExtraBatches((current) => [...current, ...((json?.batches || []) as DesignBatchSummary[])]);
      setBatchPage(next);
    } finally {
      setLoadingMoreBatches(false);
    }
  }, [batchPage, fetch]);

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
    if (!response.ok) return;
    setExtraDesigns([]);
    setPage(1);
    await mutate();
    await mutateBatches();
    if (selectedBatchId) await mutateActiveBatch();
  }, [decision, fetch, mutate, mutateActiveBatch, mutateBatches, selectedBatchId, t]);

  const openDesign = async (design: MyDesign) => {
    await onOpen(design);
    onClose?.();
  };

  if (selectedBatchId) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={() => setSelectedBatchId(null)}
          className="mb-3 text-[12px] text-btnPrimaryAccent hover:underline"
        >
          {t('my_designs_panel_all_designs', '← All designs')}
        </button>
        {activeBatchLoading && !activeBatch ? (
          <PanelSkeletonGrid count={6} columnsClassName="grid-cols-3" aspectClassName="aspect-square" />
        ) : activeBatchError && !activeBatch ? (
          <PanelError message={t('my_designs_panel_batch_failed', 'Failed to load batch')} onRetry={() => mutateActiveBatch()} />
        ) : (
          <>
            <div className="mb-3">
              <h3 className="text-[14px] font-semibold text-textColor">{activeBatch?.name}</h3>
              <p className="text-[11px] text-newTextColor/60">
                {t('my_designs_panel_variation_count', '{{count}} variation', { count: activeBatch?.designs?.length || 0 })}
              </p>
            </div>
            <DesignGrid designs={activeBatch?.designs || []} size={size} onOpen={openDesign} onDelete={handleDelete} />
          </>
        )}
      </div>
    );
  }

  if ((isLoading && !data) || (batchesLoading && !batchData)) {
    return <PanelSkeletonGrid count={6} columnsClassName="grid-cols-3" aspectClassName="aspect-square" />;
  }

  if ((error && !data) || (batchError && !batchData)) {
    return <PanelError message={t('my_designs_panel_failed_to_load', 'Failed to load designs')} onRetry={() => {
      mutate();
      mutateBatches();
    }} />;
  }

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
      {error && (
        <div role="alert" className="text-[12px] text-dangerText">
          {t('gallery_refresh_failed', 'Some results could not be refreshed. Try again.')}
        </div>
      )}
      {batches.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-[600] uppercase tracking-wide text-newTextColor/60">
            {t('my_designs_panel_batches', 'Bulk Create batches')}
          </h3>
          <ul className="grid gap-[10px]" style={designerGalleryGridStyle(size)}>
            {batches.map((batch) => (
              <li key={batch.id}>
                <button
                  type="button"
                  onClick={() => setSelectedBatchId(batch.id)}
                  className="group relative block h-full w-full border border-studioBorder rounded-lg overflow-hidden hover:border-designerAccent/50 transition-colors cursor-pointer bg-newBgColorInner text-left"
                >
                  <DesignPreviewImage
                    src={batch.previewUrl}
                    alt={batch.name}
                    className="w-full aspect-square object-cover"
                    fallback={(
                      <div className="w-full aspect-square bg-studioBorder/10 flex items-center justify-center text-newTextColor/70 text-xs">
                        {t('my_designs_panel_no_preview', 'No preview')}
                      </div>
                    )}
                  />
                  <span className="absolute top-1 start-1 px-1.5 py-0.5 rounded-full bg-newBgColorInner/80 text-btnPrimaryAccent text-[9px] font-[500] leading-none">
                    {t('my_designs_panel_batch_badge', 'BATCH')}
                  </span>
                  <div className="p-2">
                    <p className="text-[12px] text-textColor truncate">{batch.name}</p>
                    <p className="text-[10px] text-newTextColor/60">
                      {t('my_designs_panel_variation_count', '{{count}} variation', { count: batch.count })}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {hasMoreBatches && (
            <LoadMore
              loading={loadingMoreBatches}
              onClick={loadMoreBatches}
              label={t('my_designs_panel_load_more_batches', 'Load more batches')}
            />
          )}
        </section>
      )}
      {designs.length === 0 && batches.length === 0 ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-8">
          {query
            ? t('my_designs_panel_no_search_results', 'No designs match “{{query}}”.', { query, interpolation: { escapeValue: false } })
            : imageOnly
              ? t('my_designs_panel_no_image_designs', 'No image designs yet.')
              : t('my_designs_panel_no_designs_yet', 'No designs yet. Start one from a format or template!')}
        </div>
      ) : designs.length > 0 && (
        <DesignGrid designs={designs} size={size} onOpen={openDesign} onDelete={handleDelete} />
      )}
      {hasMore && (
        <LoadMore
          loading={loadingMore}
          onClick={loadMore}
          label={loadingMore ? t('loading', 'Loading...') : t('my_designs_panel_load_more', 'Load more')}
        />
      )}
    </div>
  );
};

const DesignGrid: FC<{
  designs: MyDesign[];
  size: 's' | 'm' | 'l';
  onOpen: (design: MyDesign) => void | Promise<void>;
  onDelete: (design: MyDesign) => void;
}> = ({ designs, size, onOpen, onDelete }) => {
  const t = useT();
  return (
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
              onPrimary={() => onOpen(design)}
            />
            <Button
              danger
              aria-label={t('my_designs_panel_delete_design', 'Delete {{name}}', { name: design.name, interpolation: { escapeValue: false } })}
              onClick={() => onDelete(design)}
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
  );
};

const LoadMore: FC<{ loading: boolean; onClick: () => void; label: string }> = ({ loading, onClick, label }) => (
  <div className="flex justify-center mt-3">
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="px-[18px] py-[9px] rounded-[8px] border border-newTableBorder bg-newBgColorInner text-[13px] text-textColor hover:bg-boxHover transition-colors disabled:opacity-60"
    >
      {label}
    </button>
  </div>
);
