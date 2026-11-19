'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { DesignPreviewImage } from './design-preview-image';

interface MyDesign {
  id: string;
  name: string;
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
  onOpen: (design: MyDesign) => void;
  onClose?: () => void;
  initialBatchId?: string;
  imageOnly?: boolean;
}

const PAGE_LIMIT = 50;

export const MyDesignsPanel: FC<MyDesignsPanelProps> = ({ onOpen, onClose, initialBatchId, imageOnly = false }) => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const decision = useDecisionModal();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(initialBatchId || null);

  const { data, error, isLoading, mutate } = useSWR(
    `my-designs-${user.orgId}-root`,
    async () => {
      const res = await fetch(`/media/designs?page=1&limit=${PAGE_LIMIT}&group=root`);
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

  const [extraDesigns, setExtraDesigns] = useState<MyDesign[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [extraBatches, setExtraBatches] = useState<DesignBatchSummary[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [loadingMoreBatches, setLoadingMoreBatches] = useState(false);

  useEffect(() => {
    setExtraDesigns([]);
    setPage(1);
    setExtraBatches([]);
    setBatchPage(1);
    setSelectedBatchId(initialBatchId || null);
  }, [user.orgId, initialBatchId]);

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
      const res = await fetch(`/media/designs?page=${next}&limit=${PAGE_LIMIT}&group=root`);
      if (!res.ok) return;
      const json = await res.json();
      setExtraDesigns((current) => [...current, ...((json?.designs || []) as MyDesign[])]);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  }, [fetch, page]);

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
        { name: design.name }
      ),
      approveLabel: t('delete', 'Delete'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    await fetch(`/media/designs/${design.id}`, { method: 'DELETE' });
    setExtraDesigns([]);
    setPage(1);
    mutate();
    mutateBatches();
    if (selectedBatchId) mutateActiveBatch();
  }, [decision, fetch, mutate, mutateActiveBatch, mutateBatches, selectedBatchId, t]);

  const openDesign = (design: MyDesign) => {
    onOpen(design);
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
                {t('my_designs_panel_variation_count', '{{count}} variations', { count: activeBatch?.designs?.length || 0 })}
              </p>
            </div>
            <DesignGrid designs={activeBatch?.designs || []} onOpen={openDesign} onDelete={handleDelete} />
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
    <div className="p-4">
      {batches.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-[600] uppercase tracking-wide text-newTextColor/60">
            {t('my_designs_panel_batches', 'Bulk Create batches')}
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setSelectedBatchId(batch.id)}
                className="group relative border border-studioBorder rounded-lg overflow-hidden hover:border-designerAccent/50 transition-colors cursor-pointer bg-newBgColorInner text-left"
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
                    {t('my_designs_panel_variation_count', '{{count}} variations', { count: batch.count })}
                  </p>
                </div>
              </button>
            ))}
          </div>
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
          {imageOnly
            ? t('my_designs_panel_no_image_designs', 'No image designs yet.')
            : t('my_designs_panel_no_designs_yet', 'No designs yet. Start one from a format or template!')}
        </div>
      ) : (
        <>
          {designs.length > 0 && <DesignGrid designs={designs} onOpen={openDesign} onDelete={handleDelete} />}
          {hasMore && (
            <LoadMore
              loading={loadingMore}
              onClick={loadMore}
              label={loadingMore ? t('loading', 'Loading...') : t('my_designs_panel_load_more', 'Load more')}
            />
          )}
        </>
      )}
    </div>
  );
};

const DesignGrid: FC<{
  designs: MyDesign[];
  onOpen: (design: MyDesign) => void;
  onDelete: (design: MyDesign) => void;
}> = ({ designs, onOpen, onDelete }) => {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-3">
      {designs.map((design) => (
        <div
          key={design.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(design)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(design);
            }
          }}
          className="group relative border border-studioBorder rounded-lg overflow-hidden hover:border-designerAccent/50 transition-colors cursor-pointer bg-newBgColorInner"
        >
          <DesignPreviewImage
            src={design.previewUrl || design.previewDataUrl}
            alt={design.name}
            className="w-full aspect-square object-cover"
            fallback={(
              <div className="w-full aspect-square bg-studioBorder/10 flex items-center justify-center text-newTextColor/70 text-xs">
                {t('my_designs_panel_no_preview', 'No preview')}
              </div>
            )}
          />
          <span className="absolute top-1 start-1 px-1.5 py-0.5 rounded-full bg-newBgColorInner/80 text-btnPrimaryAccent text-[9px] font-[500] leading-none">
            {design.mode === 'video'
              ? t('my_designs_panel_video_badge', 'VIDEO')
              : t('my_designs_panel_image_badge', 'IMAGE')}
          </span>
          <div className="p-2">
            <p className="text-[12px] text-textColor truncate">{design.name}</p>
            <p className="text-[10px] text-newTextColor/60">
              {new Date(design.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete(design);
            }}
            aria-label={t('my_designs_panel_delete_design', 'Delete {{name}}', { name: design.name })}
            className="absolute top-1 end-1 p-1 bg-red-500/80 rounded-sm text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        </div>
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
