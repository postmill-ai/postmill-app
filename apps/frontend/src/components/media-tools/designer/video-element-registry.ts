import type { VideoClip } from './designer.store';

interface VideoElementHandlers {
  onFrame?: () => void;
  onError?: (clip: VideoClip) => void;
  onCanPlay?: (clip: VideoClip) => void;
  sourceAuthority?: boolean;
}

interface VideoElementEntry {
  element: HTMLVideoElement;
  clip: VideoClip;
  consumers: Map<object, VideoElementHandlers>;
  sourceAuthority?: object;
  frameCallback?: number;
}

const entries = new Map<string, VideoElementEntry>();

const notify = (entry: VideoElementEntry, event: 'frame' | 'error' | 'canplay') => {
  entry.consumers.forEach((handlers) => {
    if (event === 'frame') handlers.onFrame?.();
    if (event === 'error') handlers.onError?.(entry.clip);
    if (event === 'canplay') handlers.onCanPlay?.(entry.clip);
  });
};

const watchFrames = (entry: VideoElementEntry) => {
  const element = entry.element as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
  };
  if (!element.requestVideoFrameCallback) return;
  const onVideoFrame = () => {
    if (entries.get(entry.clip.id) !== entry) return;
    notify(entry, 'frame');
    entry.frameCallback = element.requestVideoFrameCallback!(onVideoFrame);
  };
  entry.frameCallback = element.requestVideoFrameCallback(onVideoFrame);
};

export function acquireVideoElement(
  consumer: object,
  clip: VideoClip,
  handlers: VideoElementHandlers
): HTMLVideoElement | null {
  if (!clip.src) return null;
  let entry = entries.get(clip.id);
  if (!entry) {
    const element = document.createElement('video');
    element.crossOrigin = 'anonymous';
    element.playsInline = true;
    element.preload = 'auto';
    element.style.position = 'fixed';
    element.style.left = '-10000px';
    element.style.top = '0';
    element.style.pointerEvents = 'none';
    entry = { element, clip, consumers: new Map() };
    entries.set(clip.id, entry);
    element.addEventListener('loadeddata', () => notify(entry!, 'frame'));
    element.addEventListener('seeked', () => notify(entry!, 'frame'));
    element.addEventListener('error', () => notify(entry!, 'error'));
    element.addEventListener('canplay', () => notify(entry!, 'canplay'));
    element.src = clip.src;
    document.body.appendChild(element);
    watchFrames(entry);
  } else {
    if (handlers.sourceAuthority) entry.sourceAuthority = consumer;
    if (!entry.sourceAuthority || entry.sourceAuthority === consumer) {
      entry.clip = clip;
      if (entry.element.getAttribute('src') !== clip.src) {
        entry.element.src = clip.src;
        entry.element.load();
      }
    }
  }
  entry.consumers.set(consumer, handlers);
  return entry.element;
}

export function releaseVideoElement(consumer: object, clipId: string) {
  const entry = entries.get(clipId);
  if (!entry) return;
  entry.consumers.delete(consumer);
  if (entry.sourceAuthority === consumer) entry.sourceAuthority = undefined;
  if (entry.consumers.size) return;
  entry.element.pause();
  entry.element.removeAttribute('src');
  entry.element.load();
  entry.element.remove();
  entries.delete(clipId);
}

export function releaseVideoElements(consumer: object) {
  Array.from(entries.keys()).forEach((clipId) => releaseVideoElement(consumer, clipId));
}

export function pruneVideoElements(consumer: object, liveClipIds: Set<string>) {
  entries.forEach((entry, clipId) => {
    if (!liveClipIds.has(clipId)) releaseVideoElement(consumer, clipId);
  });
}

export function sharedVideoElement(clipId: string): HTMLVideoElement | undefined {
  return entries.get(clipId)?.element;
}

export function resetVideoElementRegistry() {
  entries.forEach((entry) => {
    entry.element.pause();
    entry.element.remove();
  });
  entries.clear();
}
