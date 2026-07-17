import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';

export function getFormatMaxDurationMs(formatId: string): number {
  return CHANNEL_PRESETS.find((p) => p.id === formatId)?.maxDurationMs ?? 60000;
}

export function getDefaultClipEndMs(
  startMs: number,
  sourceDurationMs: number | undefined,
  formatId: string,
  outputDurationMs?: number,
): number {
  const formatMaxMs = getFormatMaxDurationMs(formatId);
  const globalCapMs = 60000 - startMs;
  const sourceCapMs = sourceDurationMs ?? formatMaxMs;
  const durationMs = Math.min(sourceCapMs, formatMaxMs, globalCapMs);
  let endMs = startMs + Math.max(100, durationMs);
  if (outputDurationMs !== undefined) {
    endMs = Math.min(endMs, Math.max(startMs + 100, outputDurationMs));
  }
  return endMs;
}

export function getVideoDurationMs(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.src = '';
      video.load();
    };

    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanupAll = () => {
      cleanup();
      if (timer) clearTimeout(timer);
    };

    const onLoaded = () => {
      cleanupAll();
      resolve(Number.isFinite(video.duration) ? video.duration * 1000 : undefined);
    };

    const onError = () => {
      cleanupAll();
      resolve(undefined);
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = url;

    timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 5000);
  });
}
