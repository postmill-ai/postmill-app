'use client';

import React, { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface MyDesign {
  id: string;
  name: string;
  updatedAt: string;
  previewDataUrl?: string | null;
}

interface MyDesignsPanelProps {
  onOpen: (design: MyDesign) => void;
  onClose?: () => void;
}

export const MyDesignsPanel: FC<MyDesignsPanelProps> = ({ onOpen, onClose }) => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();

  const { data, error, isLoading, mutate } = useSWR(
    `my-designs-${user.orgId}`,
    async () => {
      const res = await fetch('/media/designs?page=1&limit=50');
      if (!res.ok) throw new Error('Failed to load designs');
      return res.json();
    },
    { keepPreviousData: true }
  );

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/media/designs/${id}`, { method: 'DELETE' });
    mutate();
  }, [fetch, mutate]);

  if (isLoading && !data) {
    return <PanelSkeletonGrid count={6} columnsClassName="grid-cols-3" aspectClassName="aspect-square" />;
  }

  if (error && !data) {
    return <PanelError message={t('my_designs_panel_failed_to_load', 'Failed to load designs')} onRetry={() => mutate()} />;
  }

  const designs: MyDesign[] = data?.designs || [];

  return (
    <div className="p-4">
      {designs.length === 0 ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-8">
          {t('my_designs_panel_no_designs_yet', 'No designs yet. Start one from a format or template!')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {designs.map((d) => (
            <div
              key={d.id}
              onClick={() => {
                onOpen(d);
                onClose?.();
              }}
              className="group relative border border-[#2a2a4a] rounded-lg overflow-hidden hover:border-designerAccent/50 transition-colors cursor-pointer bg-newBgColorInner"
            >
              {d.previewDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL preview
                <img
                  src={d.previewDataUrl}
                  alt={d.name}
                  className="w-full aspect-square object-cover"
                />
              ) : (
                <div className="w-full aspect-square bg-studioBorder/10 flex items-center justify-center text-newTextColor/30 text-xs">
                  {t('my_designs_panel_no_preview', 'No preview')}
                </div>
              )}
              <div className="p-2">
                <p className="text-[12px] text-textColor truncate">{d.name}</p>
                <p className="text-[10px] text-newTextColor/60">
                  {new Date(d.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(d.id);
                }}
                className="absolute top-1 right-1 p-1 bg-red-500/80 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
