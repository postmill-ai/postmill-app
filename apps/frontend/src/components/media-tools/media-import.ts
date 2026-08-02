'use client';

import { useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import type { MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';

/**
 * Import a stock-sourced media item into the org's `/files` library so it has a
 * real `fileId` and a `/files` path. File-sourced items pass through unchanged.
 *
 * Lives here rather than beside one consumer because six surfaces need it: the
 * picker's own `requireFile` mode, the AI Designer's reference images, and the
 * settings/brand/developer avatar flows that each used to hand-roll it. Stock
 * attribution (`stockSource`, `downloadLocation`, `attribution`) must be
 * forwarded — Unsplash's API terms require the download ping.
 */
export const useImportStockMedia = () => {
  const fetch = useFetch();
  return useCallback(
    async (
      item: MediaSelectorItem,
      opts: { folderId?: string | null; name?: string } = {}
    ): Promise<MediaSelectorItem> => {
      if (item.source === 'file' && item.fileId) return item;
      const body: Record<string, unknown> = {
        url: item.url,
        name: opts.name || item.name || 'Reference',
        type: item.type,
      };
      if (item.stockSource) body.source = item.stockSource;
      if (item.downloadLocation) body.downloadLocation = item.downloadLocation;
      if (item.attribution) body.attribution = item.attribution;
      if (opts.folderId) body.folderId = opts.folderId;

      const res = await fetch('/files/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Import failed (${res.status})`);
      }
      const file = (await res.json()) as { id: string; path: string };
      return {
        ...item,
        source: 'file',
        fileId: file.id,
        url: file.path,
      };
    },
    [fetch]
  );
};
