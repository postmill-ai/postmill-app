'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { MediaSelectorItem } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import type {
  AiDesignerSessionDto,
  AiDesignerMessagePayload,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

export interface AiDesignerSessionHydrate {
  session: AiDesignerSessionDto;
  messages: AiDesignerMessagePayload[];
}

export const useAiDesignerSession = (sessionId: string | null) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    if (!sessionId) return null;
    const res = await fetch(`/ai-designer/sessions/${sessionId}`);
    if (!res.ok) return null;
    return (await res.json()) as AiDesignerSessionHydrate;
  }, [fetch, sessionId]);
  return useSWR<AiDesignerSessionHydrate | null>(
    sessionId ? `ai-designer-session-${sessionId}` : null,
    load,
    { revalidateOnFocus: false }
  );
};

/**
 * Import a stock-sourced media item into the org's `/files` library so it has a
 * real `fileId` — required before it can be referenced by the AI Designer backend.
 * File-sourced items pass through unchanged.
 */
export const useImportStockMedia = () => {
  const fetch = useFetch();
  return useCallback(
    async (item: MediaSelectorItem): Promise<MediaSelectorItem> => {
      if (item.source === 'file' && item.fileId) return item;
      const body: Record<string, unknown> = {
        url: item.url,
        name: item.name || 'Reference',
        type: item.type,
      };
      if (item.stockSource) body.source = item.stockSource;
      if (item.downloadLocation) body.downloadLocation = item.downloadLocation;
      if (item.attribution) body.attribution = item.attribution;

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
