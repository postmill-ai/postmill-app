'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { probeAudioDuration, probeVideoMetadata } from './add-media-to-timeline';

const SOURCE_DURATION_CACHE_MAX = 50;
const sourceDurationCache = new Map<string, number>();
const sourceDurationInflight = new Set<string>();
const sourceDurationListeners = new Set<() => void>();

const notifySourceDurationListeners = () => {
  for (const listener of sourceDurationListeners) listener();
};

export const getSourceDurationMs = (
  src: string,
  kind: 'video' | 'audio'
): number | undefined => {
  const cached = sourceDurationCache.get(src);
  if (cached !== undefined) {
    sourceDurationCache.delete(src);
    sourceDurationCache.set(src, cached);
    return cached;
  }
  if (!sourceDurationInflight.has(src)) {
    sourceDurationInflight.add(src);
    const probe =
      kind === 'audio'
        ? probeAudioDuration(src)
        : probeVideoMetadata(src).then((result) => result.durationMs);
    probe.then((ms) => {
      sourceDurationCache.set(src, ms);
      if (sourceDurationCache.size > SOURCE_DURATION_CACHE_MAX) {
        const oldest = sourceDurationCache.keys().next().value;
        if (oldest !== undefined) sourceDurationCache.delete(oldest);
      }
      sourceDurationInflight.delete(src);
      notifySourceDurationListeners();
    }).catch(() => {
      sourceDurationInflight.delete(src);
      notifySourceDurationListeners();
    });
  }
  return undefined;
};

export const useSourceDurationMs = (
  src: string | undefined,
  kind: 'video' | 'audio'
): number | undefined => {
  const subscribe = useCallback((onChange: () => void) => {
    if (src) getSourceDurationMs(src, kind);
    sourceDurationListeners.add(onChange);
    return () => {
      sourceDurationListeners.delete(onChange);
    };
  }, [src, kind]);
  const getSnapshot = useCallback(
    () => src ? getSourceDurationMs(src, kind) : undefined,
    [src, kind]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
};
