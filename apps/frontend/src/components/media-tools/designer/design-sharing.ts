'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';

export interface DesignShareComment {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface DesignShareSettings {
  token: string;
  enabled: boolean;
  commentsEnabled: boolean;
  expiresAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  comments: DesignShareComment[];
}

export interface DesignPreviewData {
  name: string;
  mode: 'image' | 'video';
  outputs: Array<{
    outputIndex: number;
    name: string;
    width: number;
    height: number;
    pages: Array<{ pageNumber: number; name: string }>;
  }>;
  commentsEnabled: boolean;
  expiresAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  comments: DesignShareComment[];
}

export const designShareUrl = (designId: string, origin: string): string => {
  const url = new URL('/media/designer', origin);
  url.searchParams.set('designId', designId);
  return url.toString();
};

export const designViewUrl = (designId: string, origin: string): string => {
  const url = new URL('/media/designer/view', origin);
  url.searchParams.set('designId', designId);
  return url.toString();
};

export const clientDesignShareUrl = (token: string, origin: string): string =>
  new URL(`/share/design/${encodeURIComponent(token)}`, origin).toString();

export const designPreviewImageUrl = (baseUrl: string, outputIndex: number, pageNumber: number): string =>
  `${baseUrl}/${outputIndex}/${pageNumber}`;

export const formatDesignShareDate = (value: string, language = 'en'): string =>
  new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(value));

export const backendResourceUrl = (backendUrl: string, origin: string, path: string): string =>
  `${backendUrl || origin}${path}`;

const usePreviewResource = (key: string | null, url: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Preview unavailable');
    return response.json() as Promise<DesignPreviewData>;
  }, [fetch, url]);
  return useSWR<DesignPreviewData>(key, load, { revalidateOnFocus: false });
};

export const useDesignShare = (designId: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(`/media/designs/${designId}/share`);
    if (!response.ok) throw new Error('Sharing settings unavailable');
    return response.json() as Promise<DesignShareSettings | null>;
  }, [fetch, designId]);
  return useSWR<DesignShareSettings | null>(`design-share-${designId}`, load, {
    revalidateOnFocus: false,
  });
};

export const useTeamDesignPreview = (designId?: string) =>
  usePreviewResource(
    designId ? `team-design-preview-${designId}` : null,
    designId ? `/media/designs/${designId}/preview` : '',
  );

export const usePublicDesignPreview = (token?: string) =>
  usePreviewResource(
    token ? `public-design-preview-${token}` : null,
    token ? `/public/design-share/${token}` : '',
  );
