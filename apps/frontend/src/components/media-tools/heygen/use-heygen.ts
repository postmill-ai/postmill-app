'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface HeyGenAvatar {
  avatarId: string;
  name: string;
  gender: string | null;
  previewImageUrl: string | null;
}

export interface HeyGenTalkingPhoto {
  talkingPhotoId: string;
  name: string;
  previewImageUrl: string | null;
}

export interface HeyGenVoice {
  voiceId: string;
  name: string;
  language: string | null;
  gender: string | null;
  previewAudio: string | null;
  supportPause: boolean;
  emotionSupport: boolean;
}

export interface HeyGenJob {
  id: string;
  operation: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  artifactUrl: string | null;
  fileId: string | null;
  error: string | null;
  createdAt: string;
}

// One hook per resource (react-hooks/rules-of-hooks). No hooks inside returned objects.

export function useHeygenStatus() {
  const fetch = useFetch();
  return useSWR('heygen-status', async () => {
    const res = await fetch('/media/heygen/status');
    return (await res.json()) as { configured: boolean };
  });
}

export function useHeygenAvatars(enabled: boolean) {
  const fetch = useFetch();
  return useSWR(
    enabled ? 'heygen-avatars' : null,
    async () => {
      const res = await fetch('/media/heygen/avatars');
      return (await res.json()) as { avatars: HeyGenAvatar[]; talkingPhotos: HeyGenTalkingPhoto[] };
    },
    { revalidateOnFocus: false, dedupingInterval: 600000 }
  );
}

export function useHeygenVoices(enabled: boolean) {
  const fetch = useFetch();
  return useSWR(
    enabled ? 'heygen-voices' : null,
    async () => {
      const res = await fetch('/media/heygen/voices');
      return (await res.json()) as { voices: HeyGenVoice[] };
    },
    { revalidateOnFocus: false, dedupingInterval: 600000 }
  );
}

export function useHeygenTranslateLanguages(enabled: boolean) {
  const fetch = useFetch();
  return useSWR(
    enabled ? 'heygen-translate-languages' : null,
    async () => {
      const res = await fetch('/media/heygen/translate-languages');
      return (await res.json()) as { languages: string[] };
    },
    { revalidateOnFocus: false, dedupingInterval: 600000 }
  );
}

export function useHeygenJobs(enabled: boolean) {
  const fetch = useFetch();
  return useSWR(
    enabled ? 'heygen-jobs' : null,
    async () => {
      const res = await fetch('/media/heygen/jobs');
      return (await res.json()) as HeyGenJob[];
    },
    {
      // Keep the render queue live while anything is still rendering.
      refreshInterval: (data) =>
        data?.some((j) => j.status === 'pending' || j.status === 'processing') ? 5000 : 0,
    }
  );
}
