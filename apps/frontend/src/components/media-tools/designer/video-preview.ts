import type { VideoClip, VideoOutput, VideoTrack } from './designer.store';
import {
  interpolateClipKeyframes,
  volumeAtClipTime,
  type EasePreset,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';
import {
  averageSpeedForClip,
  hasSpeedCurve,
  sourceTimeForPlayhead as sharedSourceTimeForPlayhead,
  speedAt,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';
import {
  applyTransitionAdjustment,
  transitionAdjustment,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/transitions';

interface PlayOptions {
  onTick: (ms: number) => void;
  onEnd: () => void;
  /** Restart at 0 instead of stopping when the playhead reaches the end. */
  loop?: boolean;
}

/** HTMLMediaElement.volume throws outside [0,1]. */
const clampVolume = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Speed with the pitch kept. ffmpeg's `atempo` — the export path for
 * `clip.speed` — is pitch-preserving, so the preview must be too or a sped-up
 * clip sounds a fifth higher in the browser than in the exported mp4.
 * (`preservesPitch` already defaults to true in most engines; Safari needs the
 * prefixed variant. Set both explicitly so the parity does not rest on a
 * default.)
 */
function applySpeed(el: HTMLMediaElement, speed: number) {
  el.playbackRate = speed;
  el.preservesPitch = true;
  (el as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
}

/**
 * The one volume composition rule, mirrored by the server's mixer:
 * keyframed-or-base volume × track gain × duck gain, clamped. Fades multiply
 * separately — see fadeGainAt (preview) and the export's afade filters.
 */
function effectiveVolume(clip: VideoClip, localMs: number, trackGain: number, duckGain: number): number {
  return clampVolume(volumeAtClipTime(clip, Math.max(0, localMs)) * trackGain * duckGain);
}

/**
 * Linear fade-in/out gain at a clip-local time, mirroring the export's
 * `afade=t=in/out` semantics (see ffmpeg-video-encoder.service.ts): ramp up
 * over fadeInMs from the clip start, ramp down over fadeOutMs toward the
 * (freeze-inclusive) clip end. 1 outside both ramps. The preview used to
 * ignore fades entirely — they were only audible in the exported mp4.
 */
export function fadeGainAt(clip: VideoClip, localMs: number): number {
  const clipLenMs = getEffectiveClipEnd(clip) - clip.startMs;
  let fade = 1;
  if (clip.fadeInMs && clip.fadeInMs > 0 && localMs < clip.fadeInMs) {
    fade = Math.min(fade, Math.max(0, localMs / clip.fadeInMs));
  }
  if (clip.fadeOutMs && clip.fadeOutMs > 0 && localMs > clipLenMs - clip.fadeOutMs) {
    fade = Math.min(fade, Math.max(0, (clipLenMs - localMs) / clip.fadeOutMs));
  }
  return fade;
}

/**
 * Easing and keyframe interpolation live in the shared `designer-doc/keyframes`
 * module — the same code the injected frame renderer is handed as source, so
 * the preview and an exported mp4 cannot ease differently.
 */
export type EaseType = EasePreset;
export const interpolateKeyframes = interpolateClipKeyframes;

function getEffectiveClipEnd(clip: VideoClip): number {
  return clip.endMs + (clip.freezeAtMs || 0);
}

/**
 * The playhead→source mapping lives in the shared `designer-doc/speed-curve`
 * module — the same code the injected frame renderer is handed as source, so
 * the preview and an exported mp4 seek identically. It covers the legacy
 * constant-speed path (unchanged), speed ramps (integrated curve), reverse
 * and freeze frames. Re-exported here so existing callers keep their import.
 */
export const sourceTimeForPlayhead = sharedSourceTimeForPlayhead;

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
  /** Needed to write back through `updateClip`, which is keyed by track. */
  trackId: string;
  trackType: VideoTrack['type'];
  /**
   * Interpolated keyframe props with any transition adjustment folded in.
   * `blurPx` (from a blur transition) is an extra key the renderers read;
   * absent on clips outside a transition window.
   */
  props: ReturnType<typeof interpolateKeyframes> & { blurPx?: number };
}

export function composeClipsAtPlayhead(vo: VideoOutput, playheadMs: number): ComposedClip[] {
  const result: ComposedClip[] = [];
  for (const track of vo.tracks) {
    // Hidden tracks render nothing — the frame-renderer script skips them the
    // same way, so the export matches what the editor showed.
    if (track.type === 'audio' || track.hidden) continue;
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
        const direction = isIncoming
          ? clip.transitionIn?.direction
          : clip.transitionOut?.direction;
        // The transition maths live in the shared designer-doc/transitions
        // module — the same code the injected frame renderer is handed as
        // source, so the preview and an exported mp4 cannot drift.
        props = applyTransitionAdjustment(
          props,
          transitionAdjustment(type, direction, transitionProgress, isIncoming, props.width, props.height)
        );
      }

      result.push({ clip, trackId: track.id, trackType: track.type, props });
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
  // Clips whose element fired `error` (404, CORS, bad codec). Demoted out of
  // the per-tick seek/play path so a dead clip can't keep the engine retrying
  // it every frame while the rest of the timeline plays on.
  private failedMedia: Set<string> = new Set();

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
        if (opts.loop) {
          // Loop: rewind the wall-clock baseline and the media elements, then
          // keep the rAF chain alive instead of ending.
          this.startWallMs = performance.now();
          this.startPlayheadMs = 0;
          this.seekMediaElements(0, vo);
          opts.onTick(0);
          this.rafId = requestAnimationFrame(tick);
          return;
        }
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
      // A muted (or hidden) audio track contributes nothing — its clips don't
      // play and they don't count as voice for ducking (mirrors the server
      // mixer). A hidden VISUAL track's clips must not sound either.
      if (track.hidden) continue;
      if (track.type === 'audio' && track.muted) continue;
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

        if (track.type === 'video' && clip.src && !this.failedMedia.has(clip.id) && (clip.speed == null || clip.speed > 0)) {
          const el = this.getOrCreateVideo(clip);
          if (el) {
            activeIds.add(clip.id);
            // Ramped clip: the picture must track the integrated curve, so the
            // rate follows the curve's instantaneous speed per tick and the
            // drift-correction seek below (already computed from the shared
            // integrated mapping) does the rest. Constant-speed clips are
            // untouched — their playbackRate was set once at creation.
            if (hasSpeedCurve(clip)) {
              applySpeed(el, speedAt(clip.speedCurve, Math.max(0, ms - clip.startMs)));
            }
            const seekTime = sourceTime / 1000;
            if (Math.abs(el.currentTime - seekTime) > 0.1) {
              el.currentTime = seekTime;
            }
            // Keyframed (or base) volume per tick, same composition as the
            // audio path below — video-clip audio is mixed on the server too.
            // Fade ramps multiply on top, mirroring the export's afade.
            const v = clampVolume(
              effectiveVolume(clip, ms - clip.startMs, trackGain, duckGain) *
                fadeGainAt(clip, ms - clip.startMs)
            );
            el.volume = v;
            el.muted = v <= 0;
            if (el.paused) {
              el.play().catch(() => {});
            }
          }
        }

        if (track.type === 'audio' && clip.src && !this.failedMedia.has(clip.id) && (clip.speed == null || clip.speed > 0)) {
          const el = this.getOrCreateAudio(clip);
          if (el) {
            activeIds.add(clip.id);
            // Ramped audio is approximated at the clip's AVERAGE speed — the
            // same collapse the export's mixer does (variable-tempo audio is
            // out of scope). The drift-correction seek below still uses the
            // integrated mapping, so the window stays aligned.
            if (hasSpeedCurve(clip)) {
              applySpeed(el, averageSpeedForClip(clip));
            }
            const seekTime = sourceTime / 1000;
            if (Math.abs(el.currentTime - seekTime) > 0.1) {
              el.currentTime = seekTime;
            }
            el.volume = clampVolume(
              effectiveVolume(clip, ms - clip.startMs, trackGain, duckGain) *
                fadeGainAt(clip, ms - clip.startMs)
            );
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
      if (track.type !== 'audio' || track.muted || track.hidden) continue;
      for (const clip of track.clips) {
        // Voice clips: not on a ducking track and have actual audio content.
        if (track.autoDuck) continue;
        const effectiveEnd = clip.endMs + (clip.freezeAtMs || 0);
        if (ms >= clip.startMs && ms <= effectiveEnd) return true;
      }
    }
    return false;
  }

  // The rate a clip's element starts at: the curve's average for a ramp (the
  // per-tick path refines video elements to the instantaneous speed), else the
  // constant speed as before.
  private initialRateFor(clip: VideoClip): number | null {
    if (hasSpeedCurve(clip)) return averageSpeedForClip(clip);
    return clip.speed !== undefined && clip.speed > 0 ? clip.speed : null;
  }

  // A media element that errors never becomes playable; demote the clip so the
  // per-tick path stops seeking and retrying play() on it, and log enough to
  // find the dead src.
  private markMediaFailed(clip: VideoClip, el: HTMLMediaElement) {
    console.error(`[video-preview] clip ${clip.id} failed to load: ${clip.src}`);
    this.failedMedia.add(clip.id);
    el.pause();
  }

  private getOrCreateVideo(clip: VideoClip): HTMLVideoElement | null {
    if (!clip.src) return null;
    if (this.videoElements.has(clip.id)) {
      const el = this.videoElements.get(clip.id)!;
      // An in-place regenerate (e.g. voiceover/segment re-render) keeps the
      // clip id and swaps the src — the cached element must follow, or the
      // preview keeps playing the old media forever. A previously-failed clip
      // also leaves the demoted set: the new src gets a fresh chance.
      if (el.getAttribute('src') !== clip.src) {
        el.src = clip.src;
        el.load();
        this.failedMedia.delete(clip.id);
      }
      const rate = this.initialRateFor(clip);
      if (rate !== null) {
        applySpeed(el, rate);
      }
      return el;
    }

    const el = document.createElement('video');
    el.src = clip.src;
    el.addEventListener('error', () => this.markMediaFailed(clip, el));
    // Only mute when the volume is explicitly zeroed; an unset volume defaults to
    // 1 (audible), so the preview no longer silences default video audio. A
    // keyframed volume overrides this on the next tick (see seekMediaElements).
    el.muted = volumeAtClipTime(clip, 0) <= 0;
    el.volume = clampVolume(volumeAtClipTime(clip, 0));
    const rate = this.initialRateFor(clip);
    if (rate !== null) {
      applySpeed(el, rate);
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
      // Same src-swap rule as getOrCreateVideo: a regenerated voiceover keeps
      // its clip id — without this the preview played the stale take. A new
      // src also clears the demoted-media flag.
      if (el.getAttribute('src') !== clip.src) {
        el.src = clip.src;
        el.load();
        this.failedMedia.delete(clip.id);
      }
      const rate = this.initialRateFor(clip);
      if (rate !== null) {
        applySpeed(el, rate);
      }
      return el;
    }

    const el = document.createElement('audio');
    el.src = clip.src;
    el.addEventListener('error', () => this.markMediaFailed(clip, el));
    el.volume = clampVolume(volumeAtClipTime(clip, 0));
    const rate = this.initialRateFor(clip);
    if (rate !== null) {
      applySpeed(el, rate);
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
    this.failedMedia.clear();
  }
}
