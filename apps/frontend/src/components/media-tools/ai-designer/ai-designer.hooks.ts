'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import type {
  AiDesignerSessionDto,
  AiDesignerMessagePayload,
} from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.types';

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

export interface AiDesignerSessionList {
  sessions: AiDesignerSessionDto[];
  total: number;
}

/** Previous sessions for the current org + user, newest first. */
export const useAiDesignerSessions = (limit = 30) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch(`/ai-designer/sessions?page=1&limit=${limit}`);
    if (!res.ok) return { sessions: [], total: 0 };
    return (await res.json()) as AiDesignerSessionList;
  }, [fetch, limit]);
  return useSWR<AiDesignerSessionList>('ai-designer-sessions', load, {
    revalidateOnFocus: false,
  });
};

export const useDeleteAiDesignerSession = () => {
  const fetch = useFetch();
  return useCallback(
    async (sessionId: string) => {
      const res = await fetch(`/ai-designer/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    },
    [fetch]
  );
};

// Moved to media-tools/media-import.ts — six surfaces need it, not just this one.
// Re-exported here so existing importers (and their specs) keep working.
export { useImportStockMedia } from '@postmill-ai/frontend/components/media-tools/media-import';
