'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { probeAudioMetadata, probeVideoMetadata, type VideoMetadata } from './add-media-to-timeline';

const SOURCE_DURATION_CACHE_MAX = 50;
export const SOURCE_DURATION_RETRY_MS = 30_000;
const sourceDurationCache = new Map<string, number>();
const sourceDurationFailures = new Map<string, number>();
const sourceDurationInflight = new Set<string>();
const sourceDurationListeners = new Set<() => void>();

const notifySourceDurationListeners = () => {
  for (const listener of sourceDurationListeners) listener();
};

const cacheSourceDuration = (key: string, durationMs: number) => {
  sourceDurationFailures.delete(key);
  sourceDurationCache.delete(key);
  sourceDurationCache.set(key, durationMs);
  if (sourceDurationCache.size > SOURCE_DURATION_CACHE_MAX) {
    const oldest = sourceDurationCache.keys().next().value;
    if (oldest !== undefined) sourceDurationCache.delete(oldest);
  }
};

export const getSourceDurationMs = (
  src: string,
  kind: 'video' | 'audio'
): number | undefined => {
  const key = `${kind}:${src}`;
  const cached = sourceDurationCache.get(key);
  if (cached !== undefined) {
    cacheSourceDuration(key, cached);
    return cached;
  }
  const retryAt = sourceDurationFailures.get(key);
  if (retryAt !== undefined) {
    if (retryAt > Date.now()) return undefined;
    sourceDurationFailures.delete(key);
  }
  if (!sourceDurationInflight.has(key)) {
    sourceDurationInflight.add(key);
    const succeed = (metadata: VideoMetadata) => {
      cacheSourceDuration(key, metadata.durationMs);
      notifySourceDurationListeners();
    };
    const fail = () => {
      sourceDurationFailures.set(key, Date.now() + SOURCE_DURATION_RETRY_MS);
      sourceDurationInflight.delete(key);
      notifySourceDurationListeners();
    };
    const probe = kind === 'audio'
      ? probeAudioMetadata(src, succeed)
      : probeVideoMetadata(src, succeed);
    probe.then((metadata) => {
      sourceDurationInflight.delete(key);
      if (metadata.probeFailed) fail();
      else succeed(metadata);
    }).catch(fail);
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
