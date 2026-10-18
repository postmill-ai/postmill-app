'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface MyDesign {
  id: string;
  name: string;
  updatedAt: string;
  previewUrl?: string | null;
  previewDataUrl?: string | null;
  mode?: 'image' | 'video';
}

interface MyDesignsPanelProps {
  onOpen: (design: MyDesign) => void;
  onClose?: () => void;
}

const PAGE_LIMIT = 50;

export const MyDesignsPanel: FC<MyDesignsPanelProps> = ({ onOpen, onClose }) => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const decision = useDecisionModal();

  // Page 1 stays on SWR (cache + revalidate-on-focus); pages 2+ accumulate in
  // local state behind "Load more".
  const { data, error, isLoading, mutate } = useSWR(
    `my-designs-${user.orgId}`,
    async () => {
      const res = await fetch(`/media/designs?page=1&limit=${PAGE_LIMIT}`);
      if (!res.ok) throw new Error('Failed to load designs');
      return res.json();
    },
    { keepPreviousData: true }
  );

  const [extraDesigns, setExtraDesigns] = useState<MyDesign[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // A paged list is only meaningful for the org it was fetched under — a
  // different org starts back at page 1.
  useEffect(() => {
    setExtraDesigns([]);
    setPage(1);
  }, [user.orgId]);

  const designs: MyDesign[] = useMemo(() => {
    const seen = new Map<string, MyDesign>();
    for (const d of [...(data?.designs || []), ...extraDesigns]) {
      seen.set(d.id, d);
    }
    return [...seen.values()];
  }, [data, extraDesigns]);
  const total: number = data?.total ?? designs.length;
  const hasMore = designs.length < total;

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await fetch(`/media/designs?page=${next}&limit=${PAGE_LIMIT}`);
      if (!res.ok) return;
      const json = await res.json();
      setExtraDesigns((cur) => [...cur, ...((json?.designs || []) as MyDesign[])]);
      setPage(next);
    } finally {
      setLoadingMore(false);
    }
  }, [fetch, page]);

  // Hover ✕ used to DELETE immediately — a misclick destroyed the design.
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
    // Deleting shifts every later page, so the accumulated extras are stale —
    // drop them and refetch from page 1.
    setExtraDesigns([]);
    setPage(1);
    mutate();
  }, [decision, fetch, mutate, t]);

  if (isLoading && !data) {
    return <PanelSkeletonGrid count={6} columnsClassName="grid-cols-3" aspectClassName="aspect-square" />;
  }

  if (error && !data) {
    return <PanelError message={t('my_designs_panel_failed_to_load', 'Failed to load designs')} onRetry={() => mutate()} />;
  }

  return (
    <div className="p-4">
      {designs.length === 0 ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-8">
          {t('my_designs_panel_no_designs_yet', 'No designs yet. Start one from a format or template!')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {designs.map((d) => (
              <div
                key={d.id}
                onClick={() => {
                  onOpen(d);
                  onClose?.();
                }}
                className="group relative border border-studioBorder rounded-lg overflow-hidden hover:border-designerAccent/50 transition-colors cursor-pointer bg-newBgColorInner"
              >
                {d.previewUrl || d.previewDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- file URL or data URL preview
                  <img
                    src={d.previewUrl || d.previewDataUrl || undefined}
                    alt={d.name}
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square bg-studioBorder/10 flex items-center justify-center text-newTextColor/70 text-xs">
                    {t('my_designs_panel_no_preview', 'No preview')}
                  </div>
                )}
                <span className="absolute top-1 start-1 px-1.5 py-0.5 rounded-full bg-newBgColorInner/80 text-btnPrimaryAccent text-[9px] font-[500] leading-none">
                  {d.mode === 'video'
                    ? t('my_designs_panel_video_badge', 'VIDEO')
                    : t('my_designs_panel_image_badge', 'IMAGE')}
                </span>
                <div className="p-2">
                  <p className="text-[12px] text-textColor truncate">{d.name}</p>
                  <p className="text-[10px] text-newTextColor/60">
                    {new Date(d.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(d);
                  }}
                  className="absolute top-1 right-1 p-1 bg-red-500/80 rounded-sm text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-3">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-[18px] py-[9px] rounded-[8px] border border-newTableBorder bg-newBgColorInner text-[13px] text-textColor hover:bg-boxHover transition-colors disabled:opacity-60"
              >
                {loadingMore
                  ? t('loading', 'Loading...')
                  : t('my_designs_panel_load_more', 'Load more')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
