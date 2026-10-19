'use client';

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { KeyframeEase } from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';
import { animatedProps, GraphEditor, type GraphProp } from './graph-editor';
import { PROP_DOT_COLORS, type ClipKeyframe } from './keyframe-props';
import type { VideoClip, VideoOutput } from './designer.store';

/**
 * The keyframe lane: one row per animated property of the PRIMARY selected
 * clip, pinned under the clip tracks. It renders inside the timeline's own
 * scroll container and is handed the same pixelsPerMs, so zoom and scroll
 * alignment are automatic — no rAF loop, no scroll syncing of its own.
 *
 * Diamond position math: a keyframe's tMs is clip-relative, so its absolute
 * timeline position is (clip.startMs + kf.tMs) * pixelsPerMs — the same left
 * offset the clip block itself uses.
 *
 * Gesture discipline (same as the inspector's mini timeline and clip drags):
 * a retime drag writes silently per mousemove and pushes ONE history entry on
 * mouseup; the trailing synthetic click is swallowed so it doesn't re-select.
 */

const ROW_HEIGHT = 24;

const EASE_OPTIONS: { value: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut'; labelKey: string; label: string }[] = [
  { value: 'linear', labelKey: 'designer_ease_linear', label: 'Linear' },
  { value: 'easeInOut', labelKey: 'designer_ease_in_out', label: 'Ease In-Out' },
  { value: 'easeIn', labelKey: 'designer_ease_in', label: 'Ease In' },
  { value: 'easeOut', labelKey: 'designer_ease_out', label: 'Ease Out' },
];

/** Display name for a stored ease: the preset, Custom for bezier handles. */
const easeLabelKey = (ease: KeyframeEase | undefined): [string, string] => {
  if (ease && typeof ease === 'object') return ['designer_ease_custom', 'Custom'];
  const opt = EASE_OPTIONS.find((o) => o.value === ease);
  return opt ? [opt.labelKey, opt.label] : ['designer_ease_linear', 'Linear'];
};

const formatValue = (prop: string, value: number): string =>
  prop === 'opacity' || prop === 'volume'
    ? `${Math.round(value * 100)}%`
    : String(Math.round(value));

interface KeyframeLaneProps {
  store: any;
  pixelsPerMs: number;
  /** Width of the track-label gutter the lane's own gutter aligns with. */
  labelWidth: number;
  /** Pixel width of the timeline content area (totalPixels + trailing pad). */
  contentWidth: number;
}

export const KeyframeLane: FC<KeyframeLaneProps> = ({
  store,
  pixelsPerMs,
  labelWidth,
  contentWidth,
}) => {
  const t = useT();
  const doc = store((s: any) => s.doc);
  const currentOutput = store((s: any) => s.currentOutput);
  const selectedClip = store((s: any) => s.selectedClip);

  const clip: VideoClip | undefined = useMemo(() => {
    if (doc.mode !== 'video' || !selectedClip || selectedClip.outputIndex !== currentOutput) {
      return undefined;
    }
    const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
    return vo?.tracks
      .find((tr) => tr.id === selectedClip.trackId)
      ?.clips.find((c) => c.id === selectedClip.clipId);
  }, [doc, currentOutput, selectedClip]);

  // Freeze extension included — the inspector's keyframe math uses the same span.
  const clipDurationMs = clip ? clip.endMs + (clip.freezeAtMs || 0) - clip.startMs : 1;
  const keyframes = useMemo(
    () => ((clip?.keyframes || []) as ClipKeyframe[]),
    [clip?.keyframes]
  );
  const props = useMemo(() => animatedProps(clip?.keyframes), [clip?.keyframes]);

  const [selected, setSelected] = useState<{ prop: GraphProp; tMs: number } | null>(null);
  const [easeMenu, setEaseMenu] = useState<{
    prop: GraphProp;
    tMs: number;
    x: number;
    y: number;
  } | null>(null);
  const [curveOpen, setCurveOpen] = useState(false);

  const [drag, setDrag] = useState<{ prop: GraphProp; origTMs: number; startX: number } | null>(null);
  // The dragged keyframe's CURRENT tMs — it moves with each silent write, so
  // the next mousemove must match on the new value or the drag freezes.
  const currentTMsRef = useRef(0);
  const movedRef = useRef(false);
  const justDraggedRef = useRef(false);

  // Switching clips (or losing the clip) drops lane-local interaction state —
  // the render-time adjust pattern, so no effect cascades.
  const [lastClipId, setLastClipId] = useState(clip?.id);
  if (clip?.id !== lastClipId) {
    setLastClipId(clip?.id);
    setSelected(null);
    setEaseMenu(null);
    setCurveOpen(false);
  }

  useEffect(() => {
    if (!drag || !clip || !selectedClip) return;
    // currentTMsRef/movedRef are initialised in the diamond's mousedown, NOT
    // here: this effect re-runs on every silent write (clip identity changes),
    // and re-initialising would reset the ref to origTMs mid-drag, freezing
    // the keyframe after its first move.
    const onMove = (e: MouseEvent) => {
      const dMs = (e.clientX - drag.startX) / pixelsPerMs;
      if (Math.abs(e.clientX - drag.startX) > 2) movedRef.current = true;
      const next = Math.max(0, Math.min(clipDurationMs, Math.round(drag.origTMs + dMs)));
      const updated = ((clip.keyframes || []) as ClipKeyframe[]).map((kf) =>
        kf.tMs === currentTMsRef.current ? { ...kf, tMs: next } : kf
      );
      store
        .getState()
        .updateClipSilent(selectedClip.outputIndex, selectedClip.trackId, selectedClip.clipId, {
          keyframes: updated,
        });
      currentTMsRef.current = next;
      setSelected((s) => (s ? { ...s, tMs: next } : s));
    };
    const onUp = () => {
      if (movedRef.current) {
        justDraggedRef.current = true;
        // Clear after the synthetic click that ends the drag has fired.
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
        store.getState().pushHistory(t('designer_retime_keyframe', 'Retime keyframe'));
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // A lost mouseup (pointercancel, window blur mid-drag) ends the drag the
    // same way — otherwise the gesture's listeners leak until the next drag.
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [drag, clip, clipDurationMs, pixelsPerMs, store, selectedClip, t]);

  const selectedKf =
    selected && clip
      ? keyframes.find(
          (kf) => Math.abs(kf.tMs - selected.tMs) <= 1 && kf.props[selected.prop] !== undefined
        )
      : undefined;

  const setEase = (tMs: number, ease: KeyframeEase) => {
    if (!clip || !selectedClip) return;
    const updated = ((clip.keyframes || []) as ClipKeyframe[]).map((kf) =>
      kf.tMs === tMs ? { ...kf, ease } : kf
    );
    store
      .getState()
      .updateClip(selectedClip.outputIndex, selectedClip.trackId, selectedClip.clipId, {
        keyframes: updated,
      });
  };

  /** Delete drops the prop from its keyframe; an emptied keyframe goes away. */
  const removeDiamond = (prop: GraphProp, tMs: number) => {
    if (!clip || !selectedClip) return;
    const updated = ((clip.keyframes || []) as ClipKeyframe[])
      .map((kf) => {
        if (kf.tMs !== tMs) return kf;
        const nextProps = { ...kf.props };
        delete nextProps[prop];
        return Object.keys(nextProps).length ? { ...kf, props: nextProps } : null;
      })
      .filter((kf): kf is ClipKeyframe => kf !== null);
    store
      .getState()
      .updateClip(selectedClip.outputIndex, selectedClip.trackId, selectedClip.clipId, {
        keyframes: updated,
      });
    setSelected(null);
  };

  const retimeBy = (prop: GraphProp, tMs: number, deltaMs: number) => {
    if (!clip || !selectedClip) return;
    const next = Math.max(0, Math.min(clipDurationMs, tMs + deltaMs));
    const updated = ((clip.keyframes || []) as ClipKeyframe[]).map((kf) =>
      kf.tMs === tMs ? { ...kf, tMs: next } : kf
    );
    store
      .getState()
      .updateClip(selectedClip.outputIndex, selectedClip.trackId, selectedClip.clipId, {
        keyframes: updated,
      });
    setSelected({ prop, tMs: next });
  };

  const openEaseMenu = (e: React.MouseEvent, prop: GraphProp, tMs: number) => {
    setSelected({ prop, tMs });
    setCurveOpen(false);
    setEaseMenu({ prop, tMs, x: e.clientX, y: e.clientY });
  };

  const keyboardStep = Math.max(1, Math.round(clipDurationMs * 0.01));
  const easeMenuKf = easeMenu
    ? keyframes.find((kf) => kf.tMs === easeMenu.tMs)
    : undefined;

  return (
    <div className="border-b border-studioBorder/20" data-testid="keyframe-lane">
      {/* Lane header: gutter label + selected-diamond readout. The clip's own
          span is shaded so the diamonds read as belonging to it. */}
      <div className="flex items-stretch" style={{ height: ROW_HEIGHT }}>
        <div
          className="shrink-0 border-r border-studioBorder/30 flex items-center px-2 text-[9px] font-medium uppercase tracking-wider text-textColor/40"
          style={{ width: labelWidth }}
        >
          {t('designer_label_keyframes', 'Keyframes')}
        </div>
        <div className="relative flex-1 flex items-center overflow-hidden" style={{ width: contentWidth }}>
          {clip && (
            <div
              className="absolute top-0 bottom-0 bg-designerAccent/5"
              style={{ left: clip.startMs * pixelsPerMs, width: clipDurationMs * pixelsPerMs }}
            />
          )}
          {!clip && (
            <span className="relative px-1 text-[10px] text-textColor/40">
              {t('designer_kf_lane_hint', 'Select a clip to edit its keyframes')}
            </span>
          )}
          {clip && props.length === 0 && (
            <span className="relative px-1 text-[10px] text-textColor/40">
              {t('designer_kf_lane_empty', 'No keyframes on this clip')}
            </span>
          )}
          {clip && selected && selectedKf && (
            <span className="relative px-1 text-[10px] text-textColor/60 truncate" data-testid="kf-lane-readout">
              {t('designer_kf_lane_readout', '{{prop}}: {{value}} · {{ease}} · {{ms}}ms', {
                prop: selected.prop,
                value: formatValue(selected.prop, selectedKf.props[selected.prop]),
                ease: t(...easeLabelKey(selectedKf.ease)),
                ms: Math.round(selectedKf.tMs),
              })}
            </span>
          )}
        </div>
      </div>

      {clip &&
        props.map((prop) => (
          <div
            key={prop}
            className="flex items-stretch border-t border-studioBorder/10"
            style={{ height: ROW_HEIGHT }}
            data-testid={`kf-lane-row-${prop}`}
          >
            <div
              className="shrink-0 border-r border-studioBorder/30 flex items-center gap-1 px-2 text-[9px] text-textColor/50 capitalize"
              style={{ width: labelWidth }}
            >
              <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: PROP_DOT_COLORS[prop] }}
              />
              <span className="truncate">{prop}</span>
            </div>
            <div className="relative flex-1" style={{ width: contentWidth }}>
              {keyframes
                .filter((kf) => kf.props[prop] !== undefined)
                .map((kf) => {
                  const isSel = selected?.prop === prop && Math.abs(selected.tMs - kf.tMs) <= 1;
                  return (
                    <button
                      key={`${prop}-${kf.tMs}`}
                      type="button"
                      data-testid={`kf-diamond-${prop}-${kf.tMs}`}
                      aria-label={t('designer_kf_diamond', '{{prop}} keyframe at {{ms}}ms', {
                        prop,
                        ms: Math.round(kf.tMs),
                      })}
                      aria-pressed={isSel}
                      title={t('designer_kf_diamond_hint', '{{prop}}: {{value}} at {{ms}}ms — drag to retime, right-click for easing', {
                        prop,
                        value: formatValue(prop, kf.props[prop] as number),
                        ms: Math.round(kf.tMs),
                      })}
                      className={`absolute top-1/2 w-2 h-2 rotate-45 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent ${
                        isSel ? 'ring-2 ring-white' : ''
                      }`}
                      style={{
                        left: (clip.startMs + kf.tMs) * pixelsPerMs,
                        backgroundColor: PROP_DOT_COLORS[prop],
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        currentTMsRef.current = kf.tMs;
                        movedRef.current = false;
                        setSelected({ prop, tMs: kf.tMs });
                        setDrag({ prop, origTMs: kf.tMs, startX: e.clientX });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (justDraggedRef.current) return; // the click that ends a drag
                        setSelected({ prop, tMs: kf.tMs });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        openEaseMenu(e, prop, kf.tMs);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openEaseMenu(e, prop, kf.tMs);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault();
                          e.stopPropagation();
                          removeDiamond(prop, kf.tMs);
                        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          e.stopPropagation();
                          retimeBy(prop, kf.tMs, e.key === 'ArrowLeft' ? -keyboardStep : keyboardStep);
                        }
                      }}
                    />
                  );
                })}
            </div>
          </div>
        ))}

      {/* Ease mini-menu: the four presets, then the graph editor for bezier
          handles. Same fixed-popover shape as the timeline's other menus. */}
      {easeMenu && easeMenuKf && clip && selectedClip && (
        <>
          <button
            type="button"
            aria-label={t('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => {
              setEaseMenu(null);
              setCurveOpen(false);
            }}
          />
          <div
            role="menu"
            aria-label={t('designer_kf_ease_menu', 'Keyframe easing')}
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-1.5 shadow-xl"
            style={{
              left: easeMenu.x,
              top: easeMenu.y + 4,
              transform: 'translateX(-50%)',
              minWidth: curveOpen ? 340 : 150,
            }}
          >
            {!curveOpen ? (
              <>
                {EASE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="menuitem"
                    onClick={() => {
                      setEase(easeMenu.tMs, opt.value);
                      setEaseMenu(null);
                    }}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor flex items-center justify-between gap-2"
                  >
                    {t(opt.labelKey, opt.label)}
                    {(easeMenuKf.ease === opt.value || (!easeMenuKf.ease && opt.value === 'linear')) && (
                      <span aria-hidden className="text-designerAccent">●</span>
                    )}
                  </button>
                ))}
                <div className="border-t border-studioBorder my-1" />
                <button
                  role="menuitem"
                  onClick={() => setCurveOpen(true)}
                  className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                >
                  {t('designer_edit_curve', 'Edit curve…')}
                </button>
              </>
            ) : (
              <GraphEditor
                clip={clip}
                totalMs={clipDurationMs}
                onChange={(next) =>
                  store
                    .getState()
                    .updateClipSilent(selectedClip.outputIndex, selectedClip.trackId, selectedClip.clipId, {
                      keyframes: next as VideoClip['keyframes'],
                    })
                }
                onCommit={() => store.getState().pushHistory()}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default KeyframeLane;
