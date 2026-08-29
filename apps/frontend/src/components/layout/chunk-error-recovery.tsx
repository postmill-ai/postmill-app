'use client';

import { FC, useEffect } from 'react';

// Stale-chunk recovery: after a frontend deploy, already-open sessions hold
// references to chunks that no longer exist on the server (buildId rotated) —
// dynamic imports then fail with ChunkLoadError / "Loading chunk … failed" and
// the page breaks until a manual reload. Detect that specific failure and
// reload once per session (sessionStorage guard prevents a reload loop if the
// failure persists for another reason).
const RELOAD_FLAG = 'chunk-reload-attempted';

const isChunkError = (value: unknown): boolean => {
  const err =
    value instanceof Error
      ? value
      : (value as { reason?: unknown })?.reason instanceof Error
        ? ((value as { reason: Error }).reason as Error)
        : null;
  if (!err) return false;
  return (
    err.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(err.message)
  );
};

export const ChunkErrorRecovery: FC = () => {
  useEffect(() => {
    const handler = (event: Event): void => {
      if (!isChunkError(event)) return;
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    };
    window.addEventListener('error', handler);
    window.addEventListener('unhandledrejection', handler);
    return () => {
      window.removeEventListener('error', handler);
      window.removeEventListener('unhandledrejection', handler);
    };
  }, []);

  return null;
};
