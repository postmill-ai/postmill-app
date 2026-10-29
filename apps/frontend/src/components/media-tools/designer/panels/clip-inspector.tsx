'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ColorSwatch, SegmentedControl, Slider, Stepper } from '../controls';
import { FillSection } from './fill-section';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
} from '@postmill-ai/frontend/components/ui/icons';
import type { VideoClip } from '../designer.store';
import { TEXT_ANIMATION_PRESETS, ANIMATION_TRACK_TYPES, buildTextAnimationUpdate, matchTextAnimationPreset } from '../text-animation-presets';
import { GraphEditor, GRAPH_PROPS } from '../graph-editor';
import { PROP_DOT_COLORS } from '../keyframe-props';
import { SmartFilterList } from './smart-filter-list';
import { analyseBeats } from '../beat-sync';
import { estimateBpm } from '@postmill-ai/nestjs-libraries/media/designer-doc/beat-detect';
import {
  CAPTION_PRESETS,
  captionPreset,
  type CaptionPreset,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/caption-styles';
import {
  DEFAULT_MOTION_BLUR_SAMPLES,
  DEFAULT_SHUTTER_ANGLE,
  MAX_MOTION_BLUR_SAMPLES,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/motion-blur';
import type { EaseType } from '../video-preview';
import type { KeyframeEase } from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';
import { NATIVE_BLEND_ORDER } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import {
  clipTimeForSourceTime,
  hasSpeedCurve,
  sourceTimeForClipTime,
  speedAt,
  MAX_SPEED,
  MIN_SPEED,
  type SpeedCurvePoint,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';
import {
  CLIP_LOOK_PRESETS,
  activeLookForFilters,
  lookCssFilter,
  toggleClipLook,
} from '../clip-look-presets';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { runClipTransformRequest, VIDEO_BG_REMOVAL_MODELS } from '../clip-transform';
import { FontFamilyPicker } from './font-family-picker';
import { VoiceoverClipSection } from './voiceover-clip-section';

// Same weight ladder the image-mode text panel offers.
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

interface ClipInspectorProps {
  store: any;
  outputIndex: number;
  trackId: string;
  clipId: string;
}

const PRESET_STEPS: number[] = [0.25, 0.5, 1, 2, 4];

interface KeyframeLike {
  tMs: number;
  props: Record<string, number>;
  /** A preset name, or the graph editor's bezier handles. */
  ease?: KeyframeEase;
}

/** The preset dropdown offers only the four names; handles come from the graph. */
type EasePresetName = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';

const EASE_OPTIONS: { value: EasePresetName; label: string; labelKey: string }[] = [
  { value: 'linear', label: 'Linear', labelKey: 'designer_ease_linear' },
  { value: 'easeInOut', label: 'Ease In-Out', labelKey: 'designer_ease_in_out' },
  { value: 'easeIn', label: 'Ease In', labelKey: 'designer_ease_in' },
  { value: 'easeOut', label: 'Ease Out', labelKey: 'designer_ease_out' },
];

/**
 * Clip blend modes: the canvas-native set only (the schema's CLIP_BLEND_MODES,
 * pinned to NATIVE_BLEND_ORDER by a server-side spec). Labels mirror the
 * layers panel's element blend dropdown.
 */
const CLIP_BLEND_LABELS: Record<string, string> = {
  'normal': 'Normal', 'multiply': 'Multiply', 'screen': 'Screen',
  'overlay': 'Overlay', 'darken': 'Darken', 'lighten': 'Lighten',
  'color-dodge': 'Color Dodge', 'color-burn': 'Color Burn',
  'hard-light': 'Hard Light', 'soft-light': 'Soft Light',
  'difference': 'Difference', 'exclusion': 'Exclusion',
  'hue': 'Hue', 'saturation': 'Saturation', 'color': 'Color',
  'luminosity': 'Luminosity',
};

function useKeyframeDrag(
  containerRef: React.RefObject<HTMLDivElement | null>,
  totalMs: number,
  onMove: (oldTMs: number, newTMs: number) => void,
  // Continuous moves write silently; this fires once when the gesture ends so
  // a drag lands as a single history entry.
  onCommit?: () => void,
) {
  const [dragging, setDragging] = useState<{ oldTMs: number; startX: number } | null>(null);
  // The dragged keyframe's tMs changes after each move, so match on its CURRENT
  // tMs (not the fixed mousedown value) or it moves one tick then freezes.
  const currentTMsRef = useRef(0);
  const movedRef = useRef(false);
  // True for the trailing `click` a browser fires after a drag, so marker
  // remove / timeline add handlers can ignore it.
  const justDraggedRef = useRef(false);

  useEffect(() => {
    if (!dragging) return;
    currentTMsRef.current = dragging.oldTMs;
    movedRef.current = false;
    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = e.clientX - dragging.startX;
      if (Math.abs(dx) > 2) movedRef.current = true;
      const dMs = (dx / rect.width) * totalMs;
      const clamped = Math.max(0, Math.min(totalMs, dragging.oldTMs + dMs));
      onMove(currentTMsRef.current, clamped);
      currentTMsRef.current = clamped;
    };
    const handleUp = () => {
      if (movedRef.current) {
        justDraggedRef.current = true;
        // Clear after the synthetic click has had a chance to fire.
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
        onCommit?.();
      }
      setDragging(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    // A lost mouseup (pointercancel, window blur mid-drag) ends the drag the
    // same way — otherwise the gesture's listeners leak until the next drag.
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('blur', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('blur', handleUp);
    };
  }, [dragging, totalMs, onMove, onCommit, containerRef]);

  return { setDragging, justDraggedRef };
}

const MiniKeyframeTimeline: FC<{
  keyframes: KeyframeLike[];
  totalMs: number;
  onAdd: (prop: string, tMs: number) => void;
  onMove: (oldTMs: number, newTMs: number) => void;
  onRemove: (tMs: number) => void;
  /** Fired when a continuous move gesture ends, and after each keyboard move. */
  onCommit: () => void;
}> = ({ keyframes, totalMs, onAdd, onMove, onRemove, onCommit }) => {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { setDragging, justDraggedRef } = useKeyframeDrag(ref, totalMs, onMove, onCommit);
  const [keyboardMs, setKeyboardMs] = useState(0);
  const step = Math.max(1, Math.round(totalMs * 0.01));
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={Math.round(totalMs)}
      aria-valuenow={Math.round(keyboardMs)}
      aria-label={t('designer_keyframe_timeline', 'Keyframe timeline')}
      className="relative h-5 bg-newBgColorInner border border-studioBorder/30 rounded-sm overflow-hidden cursor-crosshair focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
      onClick={(e) => {
        if (justDraggedRef.current) return; // ignore the click that follows a drag
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        const tMs = Math.round(pct * totalMs);
        setKeyboardMs(tMs);
        onAdd('x', tMs);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const delta = e.key === 'ArrowLeft' ? -step : step;
          setKeyboardMs((prev) => Math.max(0, Math.min(totalMs, prev + delta)));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onAdd('x', keyboardMs);
        }
      }}
    >
      {keyframes.map((kf) => (
        <div
          key={`${kf.tMs}-${Object.keys(kf.props).sort().join('-')}`}
          role="button"
          tabIndex={0}
          aria-label={t('designer_keyframe_at_ms', 'Keyframe at {{ms}}ms', { ms: Math.round(kf.tMs) })}
          className="absolute top-0 bottom-0 w-0.5 bg-designerAccent cursor-ew-resize focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
          style={{ left: `${(kf.tMs / totalMs) * 100}%` }}
          title={t('designer_keyframe_at_ms', 'Keyframe at {{ms}}ms', { ms: kf.tMs })}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDragging({ oldTMs: kf.tMs, startX: e.clientX });
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const step = Math.max(1, Math.round(totalMs * 0.01));
              const delta = e.key === 'ArrowLeft' ? -step : step;
              onMove(kf.tMs, Math.max(0, Math.min(totalMs, kf.tMs + delta)));
              onCommit();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              onRemove(kf.tMs);
            }
          }}
        />
      ))}
      {/* At-a-glance prop dots: one per keyframed property at each keyframe,
          coloured by property. Click jumps to that property's row below.
          tabIndex -1: the bars above stay the keyboard path; the dots are a
          pointer convenience, or the tab order would gain 7 stops per frame. */}
      {keyframes.flatMap((kf) =>
        GRAPH_PROPS.filter((p) => kf.props[p] !== undefined).map((p) => (
          <button
            key={`dot-${kf.tMs}-${p}`}
            type="button"
            tabIndex={-1}
            aria-label={t('designer_jump_to_prop_keyframes', 'Jump to {{prop}} keyframes', { prop: p })}
            title={t('designer_jump_to_prop_keyframes', 'Jump to {{prop}} keyframes', { prop: p })}
            className="absolute w-[5px] h-[5px] rounded-full hover:scale-150 transition-transform"
            style={{
              // Offset by the prop's CANONICAL index, so a given property's
              // dot sits at the same offset on every keyframe.
              left: `calc(${(kf.tMs / totalMs) * 100}% + ${GRAPH_PROPS.indexOf(p) * 6 - 2}px)`,
              bottom: 1,
              backgroundColor: PROP_DOT_COLORS[p],
            }}
            onClick={(e) => {
              e.stopPropagation();
              document
                .getElementById(`clip-kf-row-${p}`)
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }}
          />
        ))
      )}
    </div>
  );
};

const KeyframePropRow: FC<{
  prop: string;
  clip: VideoClip;
  keyframes: KeyframeLike[];
  totalMs: number;
  onAdd: (prop: string, tMs: number) => void;
  onMove: (oldTMs: number, newTMs: number) => void;
  onRemove: (tMs: number, prop?: string) => void;
  onEase: (tMs: number, ease: EasePresetName) => void;
  onCommit: () => void;
}> = ({ prop, clip, keyframes, totalMs, onAdd, onMove, onRemove, onEase, onCommit }) => {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { setDragging, justDraggedRef } = useKeyframeDrag(ref, totalMs, onMove, onCommit);
  const [keyboardMs, setKeyboardMs] = useState(0);
  const propKeyframes = keyframes.filter((kf) => kf.props[prop] !== undefined);
  const currentVal =
    prop === 'x' ? (clip.x ?? 0)
    : prop === 'y' ? (clip.y ?? 0)
    : prop === 'width' ? (clip.width ?? 1)
    : prop === 'height' ? (clip.height ?? 1)
    : prop === 'rotation' ? (clip.rotation ?? 0)
    : prop === 'opacity' ? (clip.opacity ?? 1)
    : prop === 'volume' ? (clip.volume ?? 1)
    : 0;
  const step = Math.max(1, Math.round(totalMs * 0.01));

  return (
    <div className="space-y-1" id={`clip-kf-row-${prop}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-textColor/50 capitalize">{prop}</span>
        <span className="text-[10px] text-textColor/30">
          {prop === 'opacity' || prop === 'volume' ? `${Math.round(currentVal * 100)}%` : Math.round(currentVal)}
        </span>
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs)}
        aria-valuenow={Math.round(keyboardMs)}
        aria-label={t('designer_prop_keyframe_timeline', '{{prop}} keyframe timeline', { prop })}
        className="relative h-3 bg-newBgColorInner border border-studioBorder/30 rounded-sm overflow-hidden focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
        onClick={(e) => {
          if (justDraggedRef.current) return; // ignore the click that follows a drag
          if (!ref.current) return;
          const rect = ref.current.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          const tMs = Math.round(pct * totalMs);
          setKeyboardMs(tMs);
          onAdd(prop, tMs);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const delta = e.key === 'ArrowLeft' ? -step : step;
            setKeyboardMs((prev) => Math.max(0, Math.min(totalMs, prev + delta)));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onAdd(prop, keyboardMs);
          }
        }}
      >
        {propKeyframes.map((kf) => (
          <div
            key={kf.tMs}
            role="button"
            tabIndex={0}
            aria-label={t('designer_prop_keyframe_at_ms', '{{prop}} keyframe at {{ms}}ms', { prop, ms: Math.round(kf.tMs) })}
            className="absolute top-0 bottom-0 w-2 h-2 rounded-full bg-designerAccent -translate-x-1/2 -translate-y-1/2 top-1/2 cursor-pointer hover:scale-125 transition-transform focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
            style={{ left: `${(kf.tMs / totalMs) * 100}%` }}
            title={t('designer_prop_keyframe_value_at', '{{prop}}: {{value}} at {{ms}}ms', { prop, value: kf.props[prop], ms: kf.tMs })}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDragging({ oldTMs: kf.tMs, startX: e.clientX });
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (justDraggedRef.current) return; // a drag ends in a click — don't delete
              onRemove(kf.tMs, prop);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const step = Math.max(1, Math.round(totalMs * 0.01));
                const delta = e.key === 'ArrowLeft' ? -step : step;
                onMove(kf.tMs, Math.max(0, Math.min(totalMs, kf.tMs + delta)));
                onCommit();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                onRemove(kf.tMs, prop);
              }
            }}
          />
        ))}
      </div>
      {propKeyframes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {propKeyframes.map((kf) => (
            <select
              key={kf.tMs}
              // Handles have no name; the dropdown says Custom until reset.
              value={typeof kf.ease === 'string' ? kf.ease : 'custom'}
              onChange={(e) => onEase(kf.tMs, e.target.value as EasePresetName)}
              className="h-5 px-1 rounded-sm text-[9px] bg-newBgColor border border-studioBorder text-textColor outline-hidden"
            >
              {typeof kf.ease === 'object' && (
                <option value="custom">{t('designer_ease_custom', 'Custom')}</option>
              )}
              {EASE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey, opt.label)}</option>
              ))}
            </select>
          ))}
        </div>
      )}
    </div>
  );
};

export const ClipInspector: FC<ClipInspectorProps> = ({ store, outputIndex, trackId, clipId }) => {
  // Named `translate` (not `t`) — this component already uses `t` as a `.find()` callback var.
  const translate = useT();
  const toaster = useToaster();
  const doc = store((s: any) => s.doc);
  const hasKeyframeClipboard = store((s: any) => !!s.keyframeClipboard?.length);
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const vo = doc.outputs[outputIndex];

  const clip: VideoClip | undefined = useMemo(() => {
    if (!vo?.tracks) return undefined;
    const track = vo.tracks.find((t: any) => t.id === trackId);
    return track?.clips.find((c: any) => c.id === clipId);
  }, [vo, trackId, clipId]);

  const parentTrack = useMemo(() => {
    if (!vo?.tracks) return undefined;
    return vo.tracks.find((t: any) => t.id === trackId);
  }, [vo, trackId]);

  const clipTrackType = parentTrack?.type;
  const keyframes = useMemo(() => clip?.keyframes || [], [clip?.keyframes]);
  const [graphOpen, setGraphOpen] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const filters = useMemo(() => clip?.filters || [], [clip?.filters]);
  const activeLook = useMemo(() => activeLookForFilters(clip?.filters), [clip?.filters]);
  const totalMs = clip ? (clip.endMs + (clip.freezeAtMs || 0)) - clip.startMs : 1;

  const updateClip = useCallback(
    (updates: Partial<VideoClip>) => {
      const st = store.getState();
      // A rejected write used to vanish silently — the inspector looked alive
      // but nothing landed. Say so.
      if (!st.updateClipSilent(outputIndex, trackId, clipId, updates)) {
        toaster.show(
          translate('designer_clip_update_rejected', 'That clip change could not be applied'),
          'warning'
        );
        return;
      }
      st.pushHistory();
    },
    [store, outputIndex, trackId, clipId, toaster, translate],
  );

  // Continuous controls (sliders, keyframe drags) write silently per tick and
  // commit ONE history entry on release — the same discipline
  // `updateElementsSilent` gives the element inspector.
  const updateClipSilent = useCallback(
    (updates: Partial<VideoClip>) => {
      store.getState().updateClipSilent(outputIndex, trackId, clipId, updates);
    },
    [store, outputIndex, trackId, clipId],
  );

  const commitClip = useCallback(() => {
    store.getState().pushHistory();
  }, [store]);

  // --- Speed ramp -----------------------------------------------------------
  const ramped = !!clip && hasSpeedCurve(clip);
  const clipDurationMs = clip ? clip.endMs - clip.startMs : 0;

  /**
   * Write a speed curve and recompute the clip's TIMELINE end from it.
   * CapCut-style: the consumed SOURCE window stays fixed across the edit, so
   * the clip shrinks/grows to whatever the new integral implies — recomputed
   * through the inverse mapping and clamped inside the composition (the store
   * rejects an endMs past the output duration; we clamp instead of extending
   * the output, so a curve edit can never silently re-time other tracks).
   */
  const applySpeedCurve = useCallback(
    (curve: SpeedCurvePoint[] | undefined) => {
      if (!clip) return;
      const updates: Partial<VideoClip> = { speedCurve: curve };
      if (curve && curve.length >= 2 && clip.speed !== 0) {
        const trimIn = clip.trimInMs || 0;
        // The consumed source window is direction-independent (a reversed clip
        // plays the same span backwards), so both the integral and its inverse
        // are evaluated on the UNMIRRORED mapping.
        const forward = { ...clip, reverse: false };
        const consumed = sourceTimeForClipTime(forward, clipDurationMs) - trimIn;
        const newDuration = clipTimeForSourceTime({ ...forward, speedCurve: curve }, trimIn + consumed);
        updates.endMs = Math.min(
          vo.durationMs,
          clip.startMs + Math.max(100, Math.round(newDuration)),
        );
      }
      updateClip(updates);
    },
    [clip, clipDurationMs, vo, updateClip],
  );

  const toggleRamp = useCallback(() => {
    if (!clip) return;
    if (ramped) {
      // Removing the ramp returns the clip to its stored constant speed.
      updateClip({ speedCurve: undefined });
      return;
    }
    // Seed a flat curve at the current speed: two endpoints consume exactly
    // what `clip.speed` did, so enabling the ramp never re-times the clip.
    const s = clip.speed ?? 1;
    updateClip({
      speedCurve: [
        { atMs: 0, speed: s },
        { atMs: Math.max(1, clipDurationMs), speed: s },
      ],
    });
  }, [clip, ramped, clipDurationMs, updateClip]);

  const setCurvePoint = useCallback(
    (idx: number, patch: Partial<SpeedCurvePoint>) => {
      if (!clip?.speedCurve) return;
      const next = clip.speedCurve
        .map((p, i) => (i === idx ? { ...p, ...patch } : p))
        .map((p) => ({
          atMs: Math.min(Math.max(0, Math.round(p.atMs)), clipDurationMs),
          speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(p.speed * 100) / 100)),
        }))
        .sort((a, b) => a.atMs - b.atMs);
      applySpeedCurve(next);
    },
    [clip, clipDurationMs, applySpeedCurve],
  );

  const addCurvePoint = useCallback(() => {
    if (!clip?.speedCurve || clip.speedCurve.length >= 100) return;
    const curve = clip.speedCurve;
    // The widest gap gets the new point, mid-time at the interpolated speed.
    let gapIdx = 0;
    let gap = 0;
    for (let i = 0; i < curve.length - 1; i++) {
      const g = curve[i + 1].atMs - curve[i].atMs;
      if (g > gap) {
        gap = g;
        gapIdx = i;
      }
    }
    if (gap < 2) return;
    const mid = Math.round((curve[gapIdx].atMs + curve[gapIdx + 1].atMs) / 2);
    applySpeedCurve(
      [...curve, { atMs: mid, speed: Math.round(speedAt(curve, mid) * 100) / 100 }].sort(
        (a, b) => a.atMs - b.atMs,
      ),
    );
  }, [clip, applySpeedCurve]);

  const removeCurvePoint = useCallback(
    (idx: number) => {
      // A ramp needs two endpoints — removing below that is "ramp off".
      if (!clip?.speedCurve || clip.speedCurve.length <= 2) return;
      applySpeedCurve(clip.speedCurve.filter((_, i) => i !== idx));
    },
    [clip, applySpeedCurve],
  );

  const hasFilter = useCallback(
    (prefix: string) => filters.some((f) => f === prefix || f.startsWith(prefix + ':')),
    [filters],
  );

  const getFilterVal = useCallback(
    (prefix: string, fallback: number): number => {
      const match = filters.find((f) => f.startsWith(prefix + ':'));
      return match ? parseFloat(match.slice(prefix.length + 1)) : fallback;
    },
    [filters],
  );

  const toggleFilter = useCallback(
    (token: string, enabled: boolean) => {
      const rest = filters.filter((f) => f !== token);
      updateClip({ filters: enabled ? [...rest, token] : rest });
    },
    [filters, updateClip],
  );

  // Filter VALUES ride sliders — silent per tick, committed by the Slider's
  // onCommit. (toggleFilter stays committing: a switch is one discrete edit.)
  const setFilterVal = useCallback(
    (prefix: string, value: number, defaultVal: number) => {
      const rest = filters.filter((f) => !(f === prefix || f.startsWith(prefix + ':')));
      if (value !== defaultVal) rest.push(`${prefix}:${value}`);
      updateClipSilent({ filters: rest });
    },
    [filters, updateClipSilent],
  );

  const handleAddKeyframe = useCallback(
    (prop: string, tMs: number) => {
      if (!clip) return;
      const existing = [...keyframes];
      const currentVal =
        prop === 'x' ? (clip.x ?? 0)
        : prop === 'y' ? (clip.y ?? 0)
        : prop === 'width' ? (clip.width ?? 1)
        : prop === 'height' ? (clip.height ?? 1)
        : prop === 'scale' ? ((clip.width ?? 1) / (clip.naturalWidth || 100))
        : prop === 'rotation' ? (clip.rotation ?? 0)
        : prop === 'opacity' ? (clip.opacity ?? 1)
        : prop === 'volume' ? (clip.volume ?? 1)
        : 0;

      const idx = existing.findIndex((kf) => kf.tMs === tMs);
      if (idx >= 0) {
        existing[idx] = { tMs, props: { ...existing[idx].props, [prop]: currentVal } };
      } else {
        existing.push({ tMs, props: { [prop]: currentVal } });
      }
      updateClip({ keyframes: existing });
    },
    [keyframes, clip, updateClip],
  );

  const handleRemoveKeyframe = useCallback(
    (tMs: number, prop?: string) => {
      const existing = keyframes
        .map((kf) => {
          if (kf.tMs === tMs) {
            if (prop) {
              const next = { ...kf.props };
              delete next[prop];
              if (Object.keys(next).length === 0) return null;
              return { tMs: kf.tMs, props: next };
            }
            return null;
          }
          return kf;
        })
        .filter(Boolean) as { tMs: number; props: Record<string, number> }[];
      updateClip({ keyframes: existing });
    },
    [keyframes, updateClip],
  );

  const handleMoveKeyframe = useCallback(
    (oldTMs: number, newTMs: number) => {
      const clamped = Math.max(0, Math.min(totalMs, newTMs));
      const existing = keyframes.map((kf) =>
        kf.tMs === oldTMs ? { ...kf, tMs: clamped } : kf
      );
      // Drags call this per mousemove — silent; the gesture's onCommit pushes.
      updateClipSilent({ keyframes: existing });
    },
    [keyframes, totalMs, updateClipSilent]
  );

  const handleSetEase = useCallback(
    (tMs: number, ease: EaseType) => {
      const existing = keyframes.map((kf) =>
        kf.tMs === tMs ? { ...kf, ease } : kf
      );
      updateClip({ keyframes: existing });
    },
    [keyframes, updateClip]
  );

  const handleKenBurns = useCallback(() => {
    if (!clip) return;
    const duration = totalMs;
    const startX = clip.x ?? 0;
    const startY = clip.y ?? 0;
    const w = clip.width ?? 1;
    const h = clip.height ?? 1;
    const zoomEnd = Math.min(w * 1.1, (clip.naturalWidth || w));

    updateClip({
      keyframes: [
        {
          tMs: 0,
          props: {
            x: startX,
            y: startY,
            width: w,
            height: h,
            rotation: clip.rotation ?? 0,
            opacity: clip.opacity ?? 1,
          },
        },
        {
          tMs: duration,
          props: {
            x: startX - (zoomEnd - w) / 2,
            y: startY - (zoomEnd / (w / h) - h) / 2,
            width: zoomEnd,
            height: zoomEnd / (w / h),
            rotation: clip.rotation ?? 0,
            opacity: clip.opacity ?? 1,
          },
        },
      ],
    });
  }, [clip, totalMs, updateClip]);

  const keyframeProps = useMemo(() => {
    const props = new Set<string>();
    for (const kf of keyframes) {
      for (const key of Object.keys(kf.props)) {
        props.add(key);
      }
    }
    return Array.from(props);
  }, [keyframes]);

  const handleApplyTextAnimation = useCallback((presetName: string) => {
    if (!clip || !clipTrackType || !ANIMATION_TRACK_TYPES.has(clipTrackType)) return;
    const preset = TEXT_ANIMATION_PRESETS.find((p) => p.name === presetName);
    if (!preset) return;
    // Reveal presets animate the text CONTENT — meaningless on a clip with
    // none (the section already hides them there; this is the belt-and-braces).
    if (preset.textReveal && clipTrackType !== 'text') return;
    // One animation at a time: the builder clears the other channel (reveal ⇄
    // keyframes) as part of the patch.
    const update = buildTextAnimationUpdate(preset, clip);
    updateClip(update);
    // Every preset animates only the first few hundred ms of the clip — with
    // the playhead anywhere later, clicking a preset visibly did nothing.
    // Seek to the clip start and play the animation window once.
    store.getState().setPlayhead(clip.startMs);
    const animWindowMs = update.keyframes?.length
      ? Math.max(...update.keyframes.map((kf) => kf.tMs))
      : (update.textReveal?.durationMs ?? clip.endMs - clip.startMs);
    window.dispatchEvent(
      new CustomEvent('designer:preview-clip-animation', {
        detail: { durationMs: Math.min(animWindowMs + 600, 3000) },
      })
    );
  }, [clip, clipTrackType, updateClip, store]);

  // Which preset the clip's current keyframes match (drives the highlight).
  const activeTextAnimation = useMemo(
    () =>
      clip && clipTrackType && ANIMATION_TRACK_TYPES.has(clipTrackType)
        ? matchTextAnimationPreset(clip.keyframes, clip.x ?? 0, clip.y ?? 0, clip.rotation ?? 0, clip.textReveal)
        : null,
    [clip, clipTrackType]
  );

  // --- AI background removal (video clips) ---------------------------------
  // Same runClipTransform request/poll/land path the timeline clip context
  // menu uses (clip-transform.ts); the choice picks WHICH removal model runs.
  // "Auto" omits `model`, so the org's configured media default wins.
  const fetch = useFetch();
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);
  const [bgRemovalRunning, setBgRemovalRunning] = useState(false);

  const runBackgroundRemoval = useCallback(
    async (model?: string) => {
      if (!clip?.src || bgRemovalRunning) return;
      setBgRemovalRunning(true);
      try {
        await runClipTransformRequest({
          store,
          target: { outputIndex, trackId, clipId },
          endpoint: '/media/remove-video-background',
          body: model ? { videoUrl: clip.src, model } : { videoUrl: clip.src },
          fetch,
          translate,
          toaster,
          isMounted: () => mountedRef.current,
        });
      } finally {
        if (mountedRef.current) setBgRemovalRunning(false);
      }
    },
    [clip?.src, bgRemovalRunning, store, outputIndex, trackId, clipId, fetch, translate, toaster],
  );

  if (!clip) return null;

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {translate('designer_video_clip', 'Video Clip')}
      </div>

      {/* Position & Size */}
      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label={translate('designer_label_x', 'X')}
          value={Math.round(clip.x ?? 0)}
          onChange={(n) => updateClip({ x: n })}
        />
        <Stepper
          label={translate('designer_label_y', 'Y')}
          value={Math.round(clip.y ?? 0)}
          onChange={(n) => updateClip({ y: n })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label={translate('designer_label_width', 'Width')}
          min={1}
          value={Math.round(clip.width ?? 1)}
          onChange={(n) => updateClip({ width: n })}
        />
        <Stepper
          label={translate('designer_label_height', 'Height')}
          min={1}
          value={Math.round(clip.height ?? 1)}
          onChange={(n) => updateClip({ height: n })}
        />
      </div>

      <Slider
        label={translate('designer_label_rotation', 'Rotation')}
        suffix="°"
        min={0}
        max={360}
        value={Math.round(clip.rotation ?? 0)}
        onChange={(n) => updateClipSilent({ rotation: n })}
        onCommit={commitClip}
      />

      <Slider
        label={translate('designer_label_opacity', 'Opacity')}
        suffix="%"
        min={0}
        max={100}
        value={Math.round((clip.opacity ?? 1) * 100)}
        onChange={(n) => updateClipSilent({ opacity: n / 100 })}
        onCommit={commitClip}
      />

      {/* Blend mode — native canvas modes only. 'Normal' stores nothing, so
          pre-blend docs and cleared clips serialise identically. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-textColor/70">
          {translate('designer_label_blend_mode', 'Blend')}
        </span>
        <select
          aria-label={translate('designer_label_blend_mode', 'Blend')}
          value={clip.blendMode || 'normal'}
          onChange={(e) =>
            updateClip({
              blendMode:
                e.target.value === 'normal'
                  ? undefined
                  : (e.target.value as VideoClip['blendMode']),
            })
          }
          className="h-[26px] px-1.5 rounded-md bg-newBgColor border border-studioBorder text-[11px] text-textColor outline-hidden"
        >
          {NATIVE_BLEND_ORDER.map((m) => (
            <option key={m} value={m}>
              {translate(`designer_blend_${m.replace(/-/g, '_')}`, CLIP_BLEND_LABELS[m] || m)}
            </option>
          ))}
        </select>
      </div>

      {/* Background removal — video clips only. Three choices mirror the
          timeline clip menu's Remove-background submenu: White / Green screen
          pin the model explicitly (allowlist-enforced server-side), Auto
          defers to the org default. */}
      {clipTrackType === 'video' && !!clip.src && (
        <div className="pt-1 border-t border-studioBorder space-y-2">
          <div className="text-[11px] text-textColor/50">
            {translate('designer_background_removal', 'Background removal')}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={bgRemovalRunning}
              title={translate('bg_removal_white_hint', 'Best for clips shot on a white/light background')}
              onClick={() => runBackgroundRemoval(VIDEO_BG_REMOVAL_MODELS.white)}
              className="flex-1 h-7 rounded text-[11px] font-medium border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('bg_removal_white_background', 'White background')}
            </button>
            <button
              type="button"
              disabled={bgRemovalRunning}
              title={translate('bg_removal_green_hint', 'Best for clips shot on a green screen')}
              onClick={() => runBackgroundRemoval(VIDEO_BG_REMOVAL_MODELS.green)}
              className="flex-1 h-7 rounded text-[11px] font-medium border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('bg_removal_green_screen', 'Green screen')}
            </button>
            <button
              type="button"
              disabled={bgRemovalRunning}
              title={translate('bg_removal_auto_hint', 'Use the organization default model')}
              onClick={() => runBackgroundRemoval()}
              className="flex-1 h-7 rounded text-[11px] font-medium border border-studioBorder text-textColor hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('bg_removal_auto', 'Auto (org default)')}
            </button>
          </div>
          <p className="text-[10px] text-textColor/40">
            {bgRemovalRunning
              ? translate('designer_bg_removal_running', 'Removing background — the clip updates when it finishes.')
              : translate('designer_bg_removal_hint', 'Replaces this clip with a background-free version.')}
          </p>
        </div>
      )}

      {/* Audio */}
      <div className="pt-1 border-t border-studioBorder">
        <div className="text-[11px] text-textColor/50 mb-1">{translate('audio', 'Audio')}</div>
        <Slider
          label={translate('designer_label_volume', 'Volume')}
          suffix="%"
          min={0}
          max={100}
          value={Math.round((clip.volume ?? 1) * 100)}
          onChange={(n) => updateClipSilent({ volume: n / 100 })}
          onCommit={commitClip}
        />
        {/* Keyframable volume. The slider sets the BASE level; a keyframed
            value replaces it where the keyframes span (per-keyframe fallback
            keeps a partially-keyframed clip on the base). Same prop the
            export bakes into the ffmpeg volume filter. */}
        <KeyframePropRow
          prop="volume"
          clip={clip}
          keyframes={keyframes}
          totalMs={totalMs}
          onAdd={handleAddKeyframe}
          onMove={handleMoveKeyframe}
          onRemove={handleRemoveKeyframe}
          onEase={handleSetEase}
          onCommit={commitClip}
        />
        {keyframes.some((kf) => kf.props.volume !== undefined) && (
          <p className="text-[10px] text-textColor/40">
            {translate(
              'designer_volume_keyframes_note',
              'Volume keyframes replace the base volume where they span.'
            )}
          </p>
        )}
        <Slider
          label={translate('designer_label_fade_in', 'Fade In')}
          suffix="ms"
          min={0}
          max={3000}
          step={100}
          value={clip.fadeInMs || 0}
          onChange={(n) => updateClipSilent({ fadeInMs: n })}
          onCommit={commitClip}
        />
        <Slider
          label={translate('designer_label_fade_out', 'Fade Out')}
          suffix="ms"
          min={0}
          max={3000}
          step={100}
          value={clip.fadeOutMs || 0}
          onChange={(n) => updateClipSilent({ fadeOutMs: n })}
          onCommit={commitClip}
        />
      </div>

      {/* Voiceover re-voice — only clips that landed from the TTS dialog
          carry the provenance this needs. */}
      {clipTrackType === 'audio' && clip.voiceover && (
        <VoiceoverClipSection
          store={store}
          outputIndex={outputIndex}
          trackId={trackId}
          clipId={clipId}
          clip={clip}
        />
      )}

      {/* Speed / Reverse / Freeze */}
      <div className="pt-1 border-t border-studioBorder space-y-2">
        <div className="text-[11px] text-textColor/50">{translate('designer_label_speed', 'Speed')}</div>
        <div className="flex gap-1">
          {PRESET_STEPS.map((s) => (
            <button
              key={s}
              onClick={() => updateClip({ speed: s, reverse: false, ...(ramped ? { speedCurve: undefined } : {}) })}
              className={`flex-1 h-7 rounded text-[11px] font-medium transition-all ${
                clip.speed === s && !clip.reverse && !ramped
                  ? 'bg-designerAccent text-white'
                  : 'border border-studioBorder text-textColor hover:bg-boxHover'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        {/* Arbitrary speed within the schema's 0.1–10 range — the presets above
            are just the common stops. Preview honours it via playbackRate and
            the server seeks/mixes with the same multiplier. Constant speed and
            the ramp below are exclusive: editing one clears the other. */}
        <Stepper
          label={translate('designer_label_custom_speed', 'Custom speed (x)')}
          min={0.1}
          max={10}
          step={0.05}
          value={Math.round((clip.speed ?? 1) * 100) / 100}
          onChange={(n) => updateClip({ speed: Math.min(10, Math.max(0.1, Math.round(n * 100) / 100)), ...(ramped ? { speedCurve: undefined } : {}) })}
        />

        {/* Speed ramp — CapCut-style variable speed within the clip. A simple
            point list (time + speed steppers, min 2 points), not a bezier
            editor. While a curve is present it REPLACES the constant speed in
            the source-time mapping, and the clip's timeline length is derived
            from the curve (fixed source window). */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/70">{translate('designer_label_speed_ramp', 'Speed ramp')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={ramped}
            onClick={toggleRamp}
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              ramped ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                ramped ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>
        {ramped && clip.speedCurve && (
          <div className="space-y-1.5">
            {clip.speedCurve.map((p, i) => (
              <div key={i} className="flex items-end gap-1">
                <div className="flex-1">
                  <Stepper
                    label={translate('designer_label_ramp_point_time', 'At (ms)')}
                    min={0}
                    max={clipDurationMs}
                    step={100}
                    value={Math.round(p.atMs)}
                    onChange={(n) => setCurvePoint(i, { atMs: n })}
                  />
                </div>
                <div className="flex-1">
                  <Stepper
                    label={translate('designer_label_ramp_point_speed', 'Speed (x)')}
                    min={MIN_SPEED}
                    max={MAX_SPEED}
                    step={0.05}
                    value={Math.round(p.speed * 100) / 100}
                    onChange={(n) => setCurvePoint(i, { speed: n })}
                  />
                </div>
                <button
                  type="button"
                  aria-label={translate('designer_ramp_remove_point', 'Remove point')}
                  disabled={clip.speedCurve!.length <= 2}
                  onClick={() => removeCurvePoint(i)}
                  className="h-[26px] w-[26px] rounded-md border border-studioBorder text-[13px] text-textColor/70 hover:bg-boxHover disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addCurvePoint}
              className="w-full h-7 rounded border border-studioBorder text-[11px] text-textColor hover:bg-boxHover"
            >
              {translate('designer_ramp_add_point', '+ Add point')}
            </button>
            {/* The clip's timeline length is DERIVED from the curve (the source
                window stays fixed), so show it read-only. */}
            <p className="text-[10px] text-textColor/40">
              {translate('designer_ramp_effective_duration', 'Effective duration: {{duration}}s', {
                duration: ((clip.endMs - clip.startMs) / 1000).toFixed(2),
              })}
            </p>
            {/* Audio cannot follow a variable tempo — the export mixes the
                clip at its average speed (the preview does the same for
                audio-only clips). */}
            <p className="text-[10px] text-textColor/40">
              {translate(
                'designer_ramp_audio_note',
                'Audio exports at the clip’s average speed while the picture ramps.'
              )}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-textColor/70">{translate('designer_label_reverse', 'Reverse')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={!!clip.reverse}
            onClick={() => updateClip({ reverse: !clip.reverse })}
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              clip.reverse ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                clip.reverse ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>

        <Stepper
          label={translate('designer_label_freeze_frame', 'Freeze frame (ms)')}
          min={0}
          max={10000}
          step={500}
          value={clip.freezeAtMs || 0}
          onChange={(n) => updateClip({ freezeAtMs: n > 0 ? n : undefined })}
        />
      </div>

      {clipTrackType === 'shape' && (
        <div className="pt-1 border-t border-studioBorder space-y-2">
          <div className="text-[11px] text-textColor/50">{translate('fill_button', 'Fill')}</div>
          <FillSection
            element={clip}
            set={(patch) => updateClip(patch)}
            label={translate('fill_button', 'Fill')}
            brandEnforcement={brandEnforcement}
          />
        </div>
      )}

      {/* Looks — named bundles of the filter tokens below. Picking one writes
          its tokens onto the clip (both renderers already apply them); clicking
          the active look clears. A look shows as active only while the tokens
          match it exactly — slider edits after are just manual edits. */}
      <div className="pt-1 border-t border-studioBorder space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-textColor/50">{translate('designer_label_looks', 'Looks')}</div>
          {activeLook && (
            <span className="text-[10px] text-designerAccent">
              {translate(activeLook.nameKey, activeLook.name)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {CLIP_LOOK_PRESETS.map((look) => {
            const active = activeLook?.id === look.id;
            return (
              <button
                key={look.id}
                type="button"
                aria-pressed={active}
                title={translate(look.nameKey, look.name)}
                onClick={() => updateClip({ filters: toggleClipLook(filters, look) })}
                className={`rounded-sm border p-1 transition-all ${
                  active
                    ? 'border-designerAccent bg-designerAccent/10'
                    : 'border-studioBorder hover:border-designerAccent/60 hover:bg-boxHover'
                }`}
              >
                {/* The swatch is preview CONTENT (a photo stand-in run through
                    the look's own CSS filter), not UI chrome — hence literal
                    gradient colours rather than theme tokens. */}
                <span
                  aria-hidden
                  className="block h-8 rounded-xs mb-1"
                  style={{
                    background:
                      'linear-gradient(135deg, #f472b6 0%, #fbbf24 35%, #34d399 65%, #60a5fa 100%)',
                    filter: lookCssFilter(look),
                  }}
                />
                <span className="block text-[10px] text-textColor/80 text-center truncate">
                  {translate(look.nameKey, look.name)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="pt-1 border-t border-studioBorder space-y-2">
        <div className="text-[11px] text-textColor/50">{translate('designer_label_filters', 'Filters')}</div>
        <div className="text-[9px] text-amber-400/70 mb-1">
          {translate('designer_filters_export_note', 'Filters will be applied during export.')}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/70">{translate('designer_label_grayscale', 'Grayscale')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={hasFilter('grayscale')}
            onClick={() => toggleFilter('grayscale', !hasFilter('grayscale'))}
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              hasFilter('grayscale') ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                hasFilter('grayscale') ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/70">{translate('designer_label_sepia', 'Sepia')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={hasFilter('sepia')}
            onClick={() => toggleFilter('sepia', !hasFilter('sepia'))}
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              hasFilter('sepia') ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                hasFilter('sepia') ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>

        <Slider
          label={translate('designer_label_blur', 'Blur')}
          suffix="px"
          min={0}
          max={20}
          step={0.5}
          value={getFilterVal('blur', 0)}
          onChange={(n) => setFilterVal('blur', n, 0)}
          onCommit={commitClip}
        />
        <Slider
          label={translate('designer_label_brightness', 'Brightness')}
          min={0}
          max={3}
          step={0.05}
          value={getFilterVal('brightness', 1)}
          onChange={(n) => setFilterVal('brightness', n, 1)}
          onCommit={commitClip}
        />
        <Slider
          label={translate('designer_label_contrast', 'Contrast')}
          min={0}
          max={3}
          step={0.05}
          value={getFilterVal('contrast', 1)}
          onChange={(n) => setFilterVal('contrast', n, 1)}
          onCommit={commitClip}
        />
        <Slider
          label={translate('designer_label_saturate', 'Saturate')}
          min={0}
          max={3}
          step={0.05}
          value={getFilterVal('saturate', 1)}
          onChange={(n) => setFilterVal('saturate', n, 1)}
          onCommit={commitClip}
        />
      </div>

      {/* Text clip content + typography — the fields add-text seeds
          (text/fontFamily/fontSize/fontWeight/fill) finally editable. The
          family picker is the shared one (custom org fonts included). */}
      {clipTrackType === 'text' && (
        <div className="pt-1 border-t border-studioBorder space-y-2">
          <div className="text-[11px] text-textColor/50">{translate('designer_label_text', 'Text')}</div>
          <textarea
            value={clip.text || ''}
            onChange={(e) => updateClip({ text: e.target.value })}
            rows={3}
            aria-label={translate('designer_label_text_content', 'Text content')}
            className="w-full px-2 py-1.5 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden resize-y"
          />
          <FontFamilyPicker
            value={clip.fontFamily || 'Inter'}
            brandEnforcement={brandEnforcement}
            onPick={(family) => updateClip({ fontFamily: family })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Stepper
              label={translate('size', 'Size')}
              min={1}
              value={Math.round(clip.fontSize ?? 32)}
              onChange={(n) => updateClip({ fontSize: n })}
            />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textColor/70">{translate('designer_label_weight', 'Weight')}</span>
              <select
                aria-label={translate('designer_label_weight', 'Weight')}
                value={clip.fontWeight ?? 400}
                onChange={(e) => updateClip({ fontWeight: parseInt(e.target.value, 10) })}
                className="h-[26px] px-1.5 rounded-md bg-newBgColor border border-studioBorder text-[11px] text-textColor outline-hidden"
              >
                {FONT_WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="clip-text-align" className="text-[11px] text-newTextColor/60">
              {translate('designer_label_align', 'Align')}
            </label>
            <SegmentedControl
              id="clip-text-align"
              value={clip.align || 'left'}
              options={([
                ['left', AlignLeftIcon, translate('designer_align_left', 'Align left')],
                ['center', AlignCenterIcon, translate('designer_align_center', 'Align center')],
                ['right', AlignRightIcon, translate('designer_align_right', 'Align right')],
                ['justify', AlignJustifyIcon, translate('designer_align_justify', 'Justify')],
              ] as const).map(([value, Icon, label]) => ({
                value,
                label: (
                  <span title={label} aria-label={label} className="flex items-center">
                    <Icon size={14} />
                  </span>
                ),
              }))}
              onChange={(align) => updateClip({ align: align as VideoClip['align'] })}
            />
          </div>
          <ColorSwatch
            label={translate('color', 'Color')}
            value={clip.fill || '#000000'}
            onChange={(hex) => updateClip({ fill: hex })}
          />
        </div>
      )}

      {/* Caption typography — the family was hardcoded at creation
          (captionClipDefaults); same shared picker as text clips. */}
      {clipTrackType === 'caption' && (
        <div className="pt-1 border-t border-studioBorder space-y-2">
          <div className="text-[11px] text-textColor/50">{translate('designer_label_font_family', 'Font family')}</div>
          <FontFamilyPicker
            value={clip.fontFamily || 'Arial'}
            brandEnforcement={brandEnforcement}
            onPick={(family) => updateClip({ fontFamily: family })}
          />
        </div>
      )}

      {/* Animation presets — keyframe presets apply to any visual clip (the
          interpolation is clip-type-agnostic); the reveal presets (Typewriter)
          stay text-only, and the section keeps its original label for text. */}
      {clipTrackType && ANIMATION_TRACK_TYPES.has(clipTrackType) && (
        <div className="pt-1 border-t border-studioBorder space-y-2">
          <div className="text-[11px] text-textColor/50">
            {clipTrackType === 'text'
              ? translate('designer_text_animations', 'Text Animations')
              : translate('designer_animations', 'Animations')}
          </div>
          <div className="flex flex-wrap gap-1">
            {TEXT_ANIMATION_PRESETS.filter(
              (preset) => !preset.textReveal || clipTrackType === 'text'
            ).map((preset) => {
              const active = activeTextAnimation === preset.name;
              return (
                <button
                  key={preset.name}
                  onClick={() => handleApplyTextAnimation(preset.name)}
                  aria-pressed={active}
                  className={`px-2 py-1 rounded-sm text-[10px] border transition-all ${
                    active
                      ? 'border-designerAccent bg-designerAccent/20 text-textColor'
                      : 'border-studioBorder text-textColor hover:border-designerAccent hover:bg-boxHover'
                  }`}
                >
                  {translate(preset.nameKey, preset.name)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Keyframes */}
      <div className="pt-1 border-t border-studioBorder space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-textColor/50">{translate('designer_label_keyframes', 'Keyframes')}</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!keyframes.length}
              onClick={() => store.getState().copyClipKeyframes(outputIndex, trackId, clipId)}
              className="px-1.5 h-[18px] rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('designer_copy_keyframes', 'Copy')}
            </button>
            <button
              type="button"
              disabled={!hasKeyframeClipboard}
              title={translate('designer_paste_keyframes_hint', 'Merge the copied keyframes onto this clip')}
              onClick={() => {
                // The paste targets the primary selection — make it this clip.
                store.getState().setSelectedClip({ outputIndex, trackId, clipId });
                store.getState().pasteClipKeyframes();
              }}
              className="px-1.5 h-[18px] rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('designer_paste_keyframes', 'Paste')}
            </button>
            <span className="text-[10px] text-textColor/30">{keyframes.length}</span>
          </div>
        </div>

        {(clipTrackType === 'image' || clipTrackType === 'text') && (
          <button
            onClick={handleKenBurns}
            className="w-full px-2 py-1.5 rounded-sm text-[11px] border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10"
          >
            {translate('designer_ken_burns_preset', 'Ken Burns Preset')}
          </button>
        )}

        {/* Caption look. The presets are the karaoke/word-pop styles social
            video runs on; the per-word timings they need already exist. */}
        {clipTrackType === 'caption' && !!clip.words?.length && (
          <div className="space-y-2">
            <div className="text-[11px] text-textColor/50">
              {translate('designer_caption_style', 'Caption style')}
            </div>
            <select
              value={clip.captionStyle?.preset || 'plain'}
              onChange={(e) =>
                updateClip({
                  captionStyle: {
                    ...(clip.captionStyle || {}),
                    preset: e.target.value as CaptionPreset,
                  },
                })
              }
              aria-label={translate('designer_caption_style', 'Caption style')}
              className="w-full h-[28px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
            >
              {CAPTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {translate(`designer_caption_preset_${p.id}`, p.label)}
                </option>
              ))}
            </select>
            {clip.captionStyle?.preset && clip.captionStyle.preset !== 'plain' && (
              <ColorSwatch
                label={translate('designer_caption_active_color', 'Active word')}
                value={
                  clip.captionStyle.activeColor ||
                  captionPreset(clip.captionStyle.preset).defaults.activeColor ||
                  '#facc15'
                }
                onChange={(hex) =>
                  updateClip({
                    captionStyle: { ...(clip.captionStyle || {}), activeColor: hex },
                  })
                }
              />
            )}
          </div>
        )}

        {/* Beat sync. Analysis runs once and the beats are stored on the clip,
            so a saved project keeps its grid. */}
        {clipTrackType === 'audio' && clip.src && (
          <div className="space-y-1.5">
            <button
              type="button"
              disabled={analysing}
              onClick={async () => {
                setAnalysing(true);
                try {
                  const { beats } = await analyseBeats(clip.src as string);
                  updateClip({ beats });
                } finally {
                  setAnalysing(false);
                }
              }}
              className="w-full px-2 py-1.5 rounded-sm text-[11px] border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10 disabled:opacity-50"
            >
              {analysing
                ? translate('designer_detecting_beats', 'Detecting beats…')
                : translate('designer_detect_beats', 'Detect Beats')}
            </button>
            {!!clip.beats?.length && (
              <p className="text-[10px] text-textColor/40">
                {translate('designer_beats_found', '{{count}} beats · ~{{bpm}} BPM', {
                  count: clip.beats.length,
                  bpm: estimateBpm(clip.beats) ?? '?',
                })}
              </p>
            )}
          </div>
        )}

        {/* Motion blur. Rendered at export only — the preview draws one
            sample, the same trade every editor makes. */}
        {keyframes.length > 1 && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[11px] text-textColor">
              <input
                type="checkbox"
                checked={!!clip.motionBlur?.enabled}
                onChange={(e) =>
                  updateClip({
                    motionBlur: { ...(clip.motionBlur || {}), enabled: e.target.checked },
                  })
                }
                className="accent-designerAccent w-3.5 h-3.5"
              />
              {translate('designer_motion_blur', 'Motion blur')}
            </label>
            {clip.motionBlur?.enabled && (
              <>
                <Slider
                  label={translate('designer_shutter_angle', 'Shutter angle')}
                  min={0}
                  max={360}
                  step={5}
                  suffix="°"
                  value={clip.motionBlur.shutterAngle ?? DEFAULT_SHUTTER_ANGLE}
                  onChange={(n) =>
                    updateClipSilent({ motionBlur: { ...clip.motionBlur, shutterAngle: n } })
                  }
                  onCommit={commitClip}
                />
                <Slider
                  label={translate('designer_blur_samples', 'Samples')}
                  min={2}
                  max={MAX_MOTION_BLUR_SAMPLES}
                  step={1}
                  value={clip.motionBlur.samples ?? DEFAULT_MOTION_BLUR_SAMPLES}
                  onChange={(n) =>
                    updateClipSilent({ motionBlur: { ...clip.motionBlur, samples: n } })
                  }
                  onCommit={commitClip}
                />
                <p className="text-[10px] text-textColor/40">
                  {translate(
                    'designer_motion_blur_export_only',
                    'Applied when the video is rendered, not in the preview.'
                  )}
                </p>
              </>
            )}
          </div>
        )}

        {/* The clip's non-destructive filter stack, same list the layers panel
            shows. Only clips whose pixels are static carry one — see
            `smartFilterClip` in use-pixel-ops. */}
        <SmartFilterList
          stack={clip.smartFilters}
          onChange={(next) => updateClip({ smartFilters: next })}
        />

        {/* Mini timeline for keyframe placement */}
        <MiniKeyframeTimeline
          keyframes={keyframes}
          totalMs={totalMs}
          onAdd={handleAddKeyframe}
          onMove={handleMoveKeyframe}
          onRemove={handleRemoveKeyframe}
          onCommit={commitClip}
        />

        {/* Per-property keyframe controls. `volume` is excluded — it is a
            first-class row in the Audio section above, not derived here. */}
        {keyframeProps.filter((prop) => prop !== 'volume').map((prop) => (
          <KeyframePropRow
            key={prop}
            prop={prop}
            clip={clip}
            keyframes={keyframes}
            totalMs={totalMs}
            onAdd={handleAddKeyframe}
            onMove={handleMoveKeyframe}
            onRemove={handleRemoveKeyframe}
            onEase={handleSetEase}
            onCommit={commitClip}
          />
        ))}

        {/* The graph editor. Collapsed by default — it is the deep tool, and the
            rows above are enough for a straight fade. */}
        {keyframes.length > 1 && (
          <div className="rounded-sm border border-studioBorder overflow-hidden">
            <button
              type="button"
              onClick={() => setGraphOpen((v) => !v)}
              aria-expanded={graphOpen}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-textColor/70 hover:bg-boxHover"
            >
              <span>{translate('designer_graph_editor', 'Graph editor')}</span>
              <span className="text-[9px] text-textColor/40">{graphOpen ? '▾' : '▸'}</span>
            </button>
            {graphOpen && (
              <GraphEditor
                clip={clip}
                totalMs={totalMs}
                onChange={(next) => updateClipSilent({ keyframes: next as VideoClip['keyframes'] })}
                onCommit={commitClip}
              />
            )}
          </div>
        )}

        {keyframes.length > 0 && (
          <button
            onClick={() => updateClip({ keyframes: [] })}
            className="w-full px-2 py-1 rounded-sm text-[11px] border border-red-400/40 text-dangerText hover:bg-red-400/5"
          >
            {translate('designer_clear_all_keyframes', 'Clear all keyframes')}
          </button>
        )}
      </div>
    </div>
  );
};
