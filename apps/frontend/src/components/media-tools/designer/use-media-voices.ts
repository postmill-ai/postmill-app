'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';

export interface MediaVoice {
  id: string;
  label: string;
  previewUrl?: string;
}

export const useMediaVoices = (provider?: string) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    const res = await fetch(`/media/voices${qs}`);
    if (!res.ok) {
      throw new Error('Failed to load voices');
    }
    return res.json() as Promise<MediaVoice[]>;
  }, [fetch, provider]);

  const key = provider ? `media-voices-${provider}` : 'media-voices';

  return useSWR<MediaVoice[]>(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};
