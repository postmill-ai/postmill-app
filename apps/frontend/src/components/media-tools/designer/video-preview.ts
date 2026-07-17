import type { VideoClip, VideoOutput, VideoTrack } from './designer.store';

interface PlayOptions {
  onTick: (ms: number) => void;
  onEnd: () => void;
}

export type EaseType = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function applyEase(t: number, ease?: EaseType): number {
  if (!ease || ease === 'linear') return t;
  switch (ease) {
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    default:
      return t;
  }
}

export function interpolateKeyframes(
  clip: VideoClip,
  relativeMs: number,
): { x: number; y: number; width: number; height: number; rotation: number; opacity: number } {
  const defaults = {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    width: clip.width ?? 1,
    height: clip.height ?? 1,
    rotation: clip.rotation ?? 0,
    opacity: clip.opacity ?? 1,
  };

  const kfs = clip.keyframes || [];
  if (!kfs.length) return defaults;

  const sorted = [...kfs].sort((a, b) => a.tMs - b.tMs);

  if (relativeMs <= sorted[0].tMs) {
    const kf = sorted[0];
    return {
      x: kf.props.x ?? defaults.x,
      y: kf.props.y ?? defaults.y,
      width: kf.props.width ?? defaults.width,
      height: kf.props.height ?? defaults.height,
      rotation: kf.props.rotation ?? defaults.rotation,
      opacity: kf.props.opacity ?? defaults.opacity,
    };
  }

  if (relativeMs >= sorted[sorted.length - 1].tMs) {
    const kf = sorted[sorted.length - 1];
    return {
      x: kf.props.x ?? defaults.x,
      y: kf.props.y ?? defaults.y,
      width: kf.props.width ?? defaults.width,
      height: kf.props.height ?? defaults.height,
      rotation: kf.props.rotation ?? defaults.rotation,
      opacity: kf.props.opacity ?? defaults.opacity,
    };
  }

  let prev = sorted[0];
  let next = sorted[0];
  let segmentEase: EaseType = 'linear';
  for (let i = 0; i < sorted.length - 1; i++) {
    if (relativeMs >= sorted[i].tMs && relativeMs <= sorted[i + 1].tMs) {
      prev = sorted[i];
      next = sorted[i + 1];
      segmentEase = next.ease ?? prev.ease ?? 'linear';
      break;
    }
  }

  const range = next.tMs - prev.tMs;
  const rawT = range > 0 ? (relativeMs - prev.tMs) / range : 0;
  const t = applyEase(rawT, segmentEase);

  return {
    x: lerp(prev.props.x ?? defaults.x, next.props.x ?? defaults.x, t),
    y: lerp(prev.props.y ?? defaults.y, next.props.y ?? defaults.y, t),
    width: lerp(prev.props.width ?? defaults.width, next.props.width ?? defaults.width, t),
    height: lerp(prev.props.height ?? defaults.height, next.props.height ?? defaults.height, t),
    rotation: lerp(prev.props.rotation ?? defaults.rotation, next.props.rotation ?? defaults.rotation, t),
    opacity: lerp(prev.props.opacity ?? defaults.opacity, next.props.opacity ?? defaults.opacity, t),
  };
}

function getEffectiveClipEnd(clip: VideoClip): number {
  return clip.endMs + (clip.freezeAtMs || 0);
}

function getClipDuration(clip: VideoClip): number {
  return clip.endMs - clip.startMs;
}

export function sourceTimeForPlayhead(clip: VideoClip, playheadMs: number): number | null {
  const effectiveEnd = getEffectiveClipEnd(clip);
  if (playheadMs < clip.startMs || playheadMs > effectiveEnd) return null;

  // A speed:0 clip is a held (freeze) frame — always the source time at its
  // trim-in, never advancing with the playhead.
  if (clip.speed === 0) return clip.trimInMs || 0;

  const isInFreeze = clip.freezeAtMs ? playheadMs > clip.endMs : false;
  if (isInFreeze) {
    return getClipDuration(clip) + (clip.trimInMs || 0);
  }

  let relativeMs = playheadMs - clip.startMs;

  if (clip.reverse) {
    relativeMs = getClipDuration(clip) - relativeMs;
  }

  if (clip.speed !== undefined && clip.speed !== 0) {
    relativeMs = relativeMs * clip.speed;
  }

  return relativeMs + (clip.trimInMs || 0);
}

export function getClipVisualState(
  clip: VideoClip,
  playheadMs: number,
): { visible: boolean; props: ReturnType<typeof interpolateKeyframes> } | null {
  const effectiveEnd = getEffectiveClipEnd(clip);
  if (playheadMs < clip.startMs || playheadMs > effectiveEnd) return null;

  const relativeMs = Math.max(0, playheadMs - clip.startMs);
  const props = interpolateKeyframes(clip, relativeMs);

  const fadeInEnd = clip.startMs + (clip.fadeInMs || 0);
  const fadeOutStart = effectiveEnd - (clip.fadeOutMs || 0);
  let visibleOpacity = props.opacity;

  if (clip.fadeInMs && clip.fadeInMs > 0 && playheadMs <= fadeInEnd) {
    visibleOpacity = props.opacity * ((playheadMs - clip.startMs) / clip.fadeInMs);
  }
  if (clip.fadeOutMs && clip.fadeOutMs > 0 && playheadMs >= fadeOutStart) {
    visibleOpacity = props.opacity * ((effectiveEnd - playheadMs) / clip.fadeOutMs);
  }

  return {
    visible: true,
    props: { ...props, opacity: Math.max(0, Math.min(1, visibleOpacity)) },
  };
}

export interface TransitionWindow {
  fromClip: VideoClip;
  toClip: VideoClip;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export function findTransitionWindows(track: VideoTrack): TransitionWindow[] {
  if (track.type === 'audio') return [];
  const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
  const windows: TransitionWindow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const outDur = from.transitionOut?.durationMs ?? 0;
    const inDur = to.transitionIn?.durationMs ?? 0;
    const dur = Math.min(outDur, inDur);
    if (dur <= 0 || from.endMs > to.startMs) continue;
    const start = from.endMs - dur;
    windows.push({ fromClip: from, toClip: to, startMs: start, endMs: from.endMs, durationMs: dur });
  }
  return windows;
}

export interface ComposedClip {
  clip: VideoClip;
  trackType: VideoTrack['type'];
  props: ReturnType<typeof interpolateKeyframes>;
}

export function composeClipsAtPlayhead(vo: VideoOutput, playheadMs: number): ComposedClip[] {
  const result: ComposedClip[] = [];
  for (const track of vo.tracks) {
    if (track.type === 'audio') continue;
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    const windows = findTransitionWindows(track);
    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i];
      const effectiveEnd = getEffectiveClipEnd(clip);
      let visible = playheadMs >= clip.startMs && playheadMs <= effectiveEnd;
      let transitionProgress: number | undefined;
      let isIncoming = false;

      // Outgoing transition window: keep the clip visible while it fades/slides out.
      const outgoing = windows.find((w) => w.fromClip.id === clip.id);
      if (outgoing && playheadMs >= outgoing.startMs && playheadMs <= outgoing.endMs) {
        visible = true;
        transitionProgress = outgoing.durationMs > 0
          ? (playheadMs - outgoing.startMs) / outgoing.durationMs
          : 0;
      }

      // Incoming transition window: show the clip early while it fades/slides in.
      const incoming = windows.find((w) => w.toClip.id === clip.id);
      if (incoming && playheadMs >= incoming.startMs && playheadMs <= incoming.endMs) {
        visible = true;
        transitionProgress = incoming.durationMs > 0
          ? (playheadMs - incoming.startMs) / incoming.durationMs
          : 0;
        isIncoming = true;
      }

      if (!visible) continue;

      const relativeMs = Math.max(0, playheadMs - clip.startMs);
      let props = interpolateKeyframes(clip, relativeMs);
      const fadeState = getClipVisualState(clip, playheadMs);
      if (fadeState) {
        props = fadeState.props;
      }

      if (transitionProgress !== undefined) {
        const type = isIncoming
          ? clip.transitionIn?.type
          : clip.transitionOut?.type;
        if (type === 'cut') {
          // 'cut' should not create a visible overlap, but if it does, keep hard switch.
          if (!isIncoming) props.opacity = 0;
        } else if (type === 'fade' || type === 'dissolve') {
          props.opacity *= isIncoming ? transitionProgress : (1 - transitionProgress);
        } else if (type === 'slide') {
          props.opacity *= isIncoming ? transitionProgress : (1 - transitionProgress);
          const direction = isIncoming
            ? (clip.transitionIn?.direction ?? 'left')
            : (clip.transitionOut?.direction ?? 'left');
          const offset = (isIncoming ? 1 - transitionProgress : transitionProgress) * (props.width || 1);
          if (direction === 'left') props.x -= offset;
          else if (direction === 'right') props.x += offset;
          else if (direction === 'up') props.y -= offset;
          else if (direction === 'down') props.y += offset;
        }
        props.opacity = Math.max(0, Math.min(1, props.opacity));
      }

      result.push({ clip, trackType: track.type, props });
    }
  }
  return result;
}

export class VideoPreviewEngine {
  private store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  private rafId: number | null = null;
  private startWallMs: number = 0;
  private startPlayheadMs: number = 0;
  private videoElements: Map<string, HTMLVideoElement> = new Map();
  private audioElements: Map<string, HTMLAudioElement> = new Map();

  constructor(store: ReturnType<typeof import('./designer.store').createDesignerStore>) {
    this.store = store;
  }

  play(opts: PlayOptions) {
    const state = this.store.getState();
    const vo = state.doc.outputs[state.currentOutput] as VideoOutput | undefined;
    if (!vo) return;

    this.startWallMs = performance.now();
    this.startPlayheadMs = state.playheadMs >= vo.durationMs ? 0 : state.playheadMs;

    const tick = () => {
      const elapsed = performance.now() - this.startWallMs;
      const ms = Math.min(vo.durationMs, this.startPlayheadMs + elapsed);

      this.seekMediaElements(ms, vo);
      opts.onTick(ms);

      if (ms >= vo.durationMs) {
        this.pause();
        opts.onEnd();
        return;
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  pause() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pauseAllMedia();
  }

  seek(ms: number) {
    const state = this.store.getState();
    const vo = state.doc.outputs[state.currentOutput] as VideoOutput | undefined;
    if (!vo) return;

    this.seekMediaElements(ms, vo);
  }

  private seekMediaElements(ms: number, vo: VideoOutput) {
    const activeIds = new Set<string>();
    for (const track of vo.tracks) {
      const trackGain = track.gain ?? 1;
      const activeVoice = track.type === 'audio' && track.autoDuck
        ? this.voiceActiveAt(vo, ms)
        : false;
      const duckGain = activeVoice ? 0.25 : 1;
      for (const clip of track.clips) {
        const effectiveEnd = clip.endMs + (clip.freezeAtMs || 0);
        if (ms < clip.startMs || ms > effectiveEnd) {
          continue;
        }

        const sourceTime = sourceTimeForPlayhead(clip, ms);
        if (sourceTime === null) continue;

        if (track.type === 'video' && clip.src && (clip.speed == null || clip.speed > 0)) {
          const el = this.getOrCreateVideo(clip);
          if (el) {
            activeIds.add(clip.id);
            const seekTime = sourceTime / 1000;
            if (Math.abs(el.currentTime - seekTime) > 0.1) {
              el.currentTime = seekTime;
            }
            if (el.paused) {
              el.play().catch(() => {});
            }
          }
        }

        if (track.type === 'audio' && clip.src && (clip.speed == null || clip.speed > 0)) {
          const el = this.getOrCreateAudio(clip);
          if (el) {
            activeIds.add(clip.id);
            const seekTime = sourceTime / 1000;
            if (Math.abs(el.currentTime - seekTime) > 0.1) {
              el.currentTime = seekTime;
            }
            el.volume = Math.min(1, (clip.volume ?? 1) * trackGain * duckGain);
            if (el.paused) {
              el.play().catch(() => {});
            }
          }
        }
      }
    }
    // Pause any media element whose clip is no longer under the playhead — a clip
    // ending mid-timeline otherwise keeps playing to the timeline's end.
    this.videoElements.forEach((el, id) => {
      if (!activeIds.has(id) && !el.paused) el.pause();
    });
    this.audioElements.forEach((el, id) => {
      if (!activeIds.has(id) && !el.paused) el.pause();
    });
  }

  private voiceActiveAt(vo: VideoOutput, ms: number): boolean {
    for (const track of vo.tracks) {
      if (track.type !== 'audio') continue;
      for (const clip of track.clips) {
        // Voice clips: not on a ducking track and have actual audio content.
        if (track.autoDuck) continue;
        const effectiveEnd = clip.endMs + (clip.freezeAtMs || 0);
        if (ms >= clip.startMs && ms <= effectiveEnd) return true;
      }
    }
    return false;
  }

  private getOrCreateVideo(clip: VideoClip): HTMLVideoElement | null {
    if (!clip.src) return null;
    if (this.videoElements.has(clip.id)) {
      const el = this.videoElements.get(clip.id)!;
      if (clip.speed !== undefined && clip.speed > 0) {
        el.playbackRate = clip.speed;
      }
      return el;
    }

    const el = document.createElement('video');
    el.src = clip.src;
    // Only mute when the volume is explicitly zeroed; an unset volume defaults to
    // 1 (audible), so the preview no longer silences default video audio.
    el.muted = clip.volume === 0;
    el.volume = Math.min(1, (clip.volume ?? 1));
    if (clip.speed !== undefined && clip.speed > 0) {
      el.playbackRate = clip.speed;
    }
    el.style.position = 'fixed';
    el.style.left = '-10000px';
    el.style.top = '0';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    this.videoElements.set(clip.id, el);
    return el;
  }

  private getOrCreateAudio(clip: VideoClip): HTMLAudioElement | null {
    if (!clip.src) return null;
    if (this.audioElements.has(clip.id)) {
      const el = this.audioElements.get(clip.id)!;
      if (clip.speed !== undefined && clip.speed > 0) {
        el.playbackRate = clip.speed;
      }
      return el;
    }

    const el = document.createElement('audio');
    el.src = clip.src;
    el.volume = Math.min(1, (clip.volume ?? 1));
    if (clip.speed !== undefined && clip.speed > 0) {
      el.playbackRate = clip.speed;
    }
    el.style.position = 'fixed';
    el.style.left = '-10000px';
    el.style.top = '0';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    this.audioElements.set(clip.id, el);
    return el;
  }

  private pauseAllMedia() {
    this.videoElements.forEach((el) => el.pause());
    this.audioElements.forEach((el) => el.pause());
  }

  destroy() {
    this.pause();
    this.videoElements.forEach((el) => {
      el.pause();
      el.remove();
    });
    this.audioElements.forEach((el) => {
      el.pause();
      el.remove();
    });
    this.videoElements.clear();
    this.audioElements.clear();
  }
}
