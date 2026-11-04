'use client';

import { probeAudioDuration, probeVideoMetadata } from './add-media-to-timeline';

const SOURCE_DURATION_CACHE_MAX = 50;
const sourceDurationCache = new Map<string, number>();
const sourceDurationInflight = new Set<string>();

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
    });
  }
  return undefined;
};
