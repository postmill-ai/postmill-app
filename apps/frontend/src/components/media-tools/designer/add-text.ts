import type { DesignerElement, VideoClip } from './designer.store';
import { ensureFontLoaded } from './fonts';
import { defaultTextBox } from './measure-text';
import type { TextStylePreset } from './text-styles';

/**
 * Creating text, in either kind of document.
 *
 * An image document gets a text ELEMENT; a video document gets a text CLIP on a
 * text track, created if the document hasn't got one yet. This used to live
 * inside the Text panel, which made that panel the only thing in the app capable
 * of adding text to a video — the timeline renders text clips but never makes
 * one. It belongs here so the Type tool, the Insert menu and ⌘K all share it.
 */

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

/** How long a new text clip lasts, unless the document is shorter. */
const DEFAULT_CLIP_MS = 4000;

/** The preset used when the caller has no opinion (Type tool, Insert ▸ Text). */
export const DEFAULT_TEXT: Pick<
  TextStylePreset,
  'name' | 'fontSize' | 'fontWeight' | 'fontFamily'
> = {
  name: 'Text',
  fontSize: 32,
  fontWeight: 700,
  fontFamily: 'Inter',
};

export interface AddTextOptions {
  /** Document-space position for the box; defaults to the canvas centre. */
  at?: { x: number; y: number };
  /** Explicit box, e.g. from a Type-tool drag. Otherwise measured from the text. */
  size?: { width: number; height: number };
}

/**
 * Add text and select it. Returns the new element/clip id, or null if the
 * document can't take one.
 */
export const addText = (
  store: Store,
  preset: Partial<TextStylePreset> = {},
  options: AddTextOptions = {}
): string | null => {
  const style = { ...DEFAULT_TEXT, ...preset };
  const state = store.getState();
  const out = state.doc.outputs[state.currentOutput];
  if (!out) return null;

  void ensureFontLoaded(style.fontFamily);

  // Size the box from the font so the text fits it from birth — a hardcoded box
  // overflowed every heading preset.
  const box =
    options.size ||
    defaultTextBox({
      text: style.name,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      lineHeight: (preset as TextStylePreset).lineHeight,
      letterSpacing: (preset as TextStylePreset).letterSpacing,
    });

  const x = options.at?.x ?? out.width / 2 - box.width / 2;
  const y = options.at?.y ?? out.height / 2 - box.height / 2;

  if (state.doc.mode === 'video') {
    const vo = out as never as {
      durationMs?: number;
      tracks?: { id: string; type: string }[];
    };

    let textTrack = vo.tracks?.find((t) => t.type === 'text');
    if (!textTrack) {
      state.addTrack(state.currentOutput, 'text');
      const refreshed = store.getState().doc.outputs[state.currentOutput] as never as {
        tracks: { id: string; type: string }[];
      };
      textTrack = refreshed.tracks.find((t) => t.type === 'text');
    }
    if (!textTrack) return null;

    const durationMs = vo.durationMs || 10000;
    const startMs = Math.max(0, Math.min(store.getState().playheadMs, durationMs - 1000));
    const clip: VideoClip = {
      id: '',
      startMs,
      endMs: Math.min(startMs + DEFAULT_CLIP_MS, durationMs),
      text: style.name,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fill: (preset as TextStylePreset).fill || '#000000',
      x,
      y,
      width: box.width,
      height: box.height,
      opacity: 1,
    };
    store.getState().addClip(state.currentOutput, textTrack.id, clip);

    // addClip assigns the id, so read it back off the track it landed on.
    const after = store.getState().doc.outputs[state.currentOutput] as never as {
      tracks: { id: string; clips: VideoClip[] }[];
    };
    const track = after.tracks.find((tr) => tr.id === textTrack!.id);
    const added = track?.clips[track.clips.length - 1];
    if (added) {
      store.getState().setSelectedClip({
        outputIndex: state.currentOutput,
        trackId: textTrack.id,
        clipId: added.id,
      });
      return added.id;
    }
    return null;
  }

  const el: DesignerElement = {
    id: '',
    type: 'text',
    x,
    y,
    width: box.width,
    height: box.height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: style.name,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    fontStyle: 'normal',
    fill: (preset as TextStylePreset).fill || '#000000',
    align: 'center',
    lineHeight: (preset as TextStylePreset).lineHeight,
    letterSpacing: (preset as TextStylePreset).letterSpacing,
  };
  state.addElement(el);
  return store.getState().selectedIds[0] || null;
};
