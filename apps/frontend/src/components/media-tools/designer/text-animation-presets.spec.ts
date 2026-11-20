import { describe, it, expect } from 'vitest';
import {
  TEXT_ANIMATION_PRESETS,
  TYPEWRITER_MS_PER_CHAR,
  buildTextAnimationUpdate,
  matchTextAnimationPreset,
  matchTextAnimationPresets,
} from './text-animation-presets';
import { createDesignerStore } from './designer.store';

const presetByName = (name: string) => {
  const preset = TEXT_ANIMATION_PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`preset ${name} not found`);
  return preset;
};

describe('matchTextAnimationPreset', () => {
  it('matches a preset applied at a non-origin base position', () => {
    // 'Fade Up' applied to a clip sitting at (100, 200).
    const keyframes = [
      { tMs: 0, props: { y: 220, opacity: 0 }, ease: 'easeOut' as const },
      { tMs: 500, props: { y: 200, opacity: 1 }, ease: 'easeOut' as const },
    ];
    expect(matchTextAnimationPreset(keyframes, 100, 200)).toBe('Fade Up');
  });

  it('matches presets with absolute-only props regardless of position', () => {
    const keyframes = [
      { tMs: 0, props: { opacity: 0 }, ease: 'easeOut' as const },
      { tMs: 400, props: { opacity: 1 }, ease: 'easeOut' as const },
    ];
    expect(matchTextAnimationPreset(keyframes, 50, 60)).toBe('Pop');
  });

  it('Typewriter matches on textReveal, not keyframes', () => {
    // The reveal preset writes textReveal and clears the lanes — the clip must
    // still highlight Typewriter, and the old opacity ramp must match nothing.
    expect(
      matchTextAnimationPreset([], 0, 0, 0, { mode: 'chars', durationMs: 800 })
    ).toBe('Typewriter');
    expect(
      matchTextAnimationPreset(undefined, 0, 0, 0, { mode: 'words' })
    ).toBeNull(); // no words preset exists
    expect(
      matchTextAnimationPreset(
        [
          { tMs: 0, props: { opacity: 0 }, ease: 'easeInOut' as const },
          { tMs: 300, props: { opacity: 1 }, ease: 'easeInOut' as const },
        ],
        0,
        0
      )
    ).toBeNull(); // the pre-reveal Typewriter ramp matches no preset anymore
  });

  it('matches Typewriter independently of keyframes from other categories', () => {
    expect(
      matchTextAnimationPreset(
        [{ tMs: 300, props: { width: 108 } }],
        0,
        0,
        0,
        { mode: 'chars' }
      )
    ).toBe('Typewriter');
  });

  it('returns null for unmatched or empty keyframes', () => {
    expect(matchTextAnimationPreset(undefined, 0, 0)).toBeNull();
    expect(matchTextAnimationPreset([], 0, 0)).toBeNull();
    expect(
      matchTextAnimationPreset([{ tMs: 0, props: { opacity: 0.5 } }], 0, 0)
    ).toBeNull();
  });

  it('distinguishes presets that share tMs but differ in props', () => {
    // 'Slide In Left' vs 'Slide In Right' — same timing, opposite x offsets.
    const left = [
      { tMs: 0, props: { x: -60, opacity: 0 } },
      { tMs: 500, props: { x: 0, opacity: 1 } },
    ];
    expect(matchTextAnimationPreset(left, 0, 0)).toBe('Slide In Left');
  });

  it('every preset round-trips through the matcher after the apply transform', () => {
    const clip = { x: 320, y: 480, width: 200, height: 100, rotation: 5, text: 'Hello there', startMs: 0, endMs: 5000 };
    for (const preset of TEXT_ANIMATION_PRESETS) {
      const update = buildTextAnimationUpdate(preset, clip);
      expect(
        matchTextAnimationPreset(
          update.keyframes,
          clip.x,
          clip.y,
          clip.rotation,
          update.textReveal,
          clip.width,
          clip.height,
          clip.endMs - clip.startMs
        )
      ).toBe(preset.name);
    }
  });
});

describe('buildTextAnimationUpdate', () => {
  it('shifts relative props onto the clip base transform', () => {
    const update = buildTextAnimationUpdate(presetByName('Fade Up'), {
      x: 100,
      y: 200,
      rotation: 0,
      startMs: 0,
      endMs: 5000,
    });
    expect(update.keyframes).toEqual([
      { tMs: 0, props: { y: 220, opacity: 0 }, ease: 'easeOut' },
      { tMs: 500, props: { y: 200, opacity: 1 }, ease: 'easeOut' },
    ]);
    // A keyframe preset clears any reveal the clip carried.
    expect(update.textReveal).toBeUndefined();
  });

  it('Typewriter writes a per-char paced reveal', () => {
    const update = buildTextAnimationUpdate(presetByName('Typewriter'), {
      x: 0,
      y: 0,
      rotation: 0,
      text: 'Hello there', // 11 chars
      startMs: 0,
      endMs: 10000,
    });
    expect(update.keyframes).toEqual([]);
    expect(update.textReveal).toEqual({
      mode: 'chars',
      durationMs: 11 * TYPEWRITER_MS_PER_CHAR,
    });
  });

  it('clamps the reveal window at the clip duration (short clip, long text)', () => {
    const update = buildTextAnimationUpdate(presetByName('Typewriter'), {
      x: 0,
      y: 0,
      rotation: 0,
      text: 'x'.repeat(100), // 8000ms of pacing into a 2000ms clip
      startMs: 500,
      endMs: 2500,
    });
    expect(update.textReveal?.durationMs).toBe(2000);
  });

  it('omits durationMs for an empty text (the reveal then spans the clip)', () => {
    const update = buildTextAnimationUpdate(presetByName('Typewriter'), {
      x: 0,
      y: 0,
      rotation: 0,
      text: '',
      startMs: 0,
      endMs: 3000,
    });
    expect(update.textReveal).toEqual({ mode: 'chars' });
  });

  it('scales width and height from the clip base for zoom presets', () => {
    const update = buildTextAnimationUpdate(presetByName('Zoom In'), {
      width: 200,
      height: 100,
      startMs: 0,
      endMs: 5000,
    });
    expect(update.keyframes?.[0].props).toMatchObject({ width: 100, height: 50, opacity: 0 });
    expect(update.keyframes?.[1].props).toMatchObject({ width: 200, height: 100, opacity: 1 });
  });

  it('places exit presets at the end of the clip', () => {
    const update = buildTextAnimationUpdate(presetByName('Slide Out Left'), {
      x: 100,
      startMs: 2000,
      endMs: 7000,
    });
    expect(update.keyframes?.map((frame) => frame.tMs)).toEqual([4500, 5000]);
    expect(update.keyframes?.[1].props).toMatchObject({ x: 40, opacity: 0 });
  });

  it('centers zoom frames and scales text glyphs instead of re-wrapping at a fixed font size', () => {
    const clip = {
      x: 100, y: 200, width: 200, height: 100, fontSize: 24,
      text: 'Zoom', startMs: 0, endMs: 5000,
    };
    const update = buildTextAnimationUpdate(presetByName('Zoom In'), clip, true);

    expect(update.keyframes?.[0].props).toMatchObject({
      x: 150, y: 225, width: 100, height: 50, fontSize: 12, opacity: 0,
    });
    expect(update.keyframes?.[1].props).toMatchObject({
      x: 100, y: 200, width: 200, height: 100, fontSize: 24, opacity: 1,
    });
    expect(matchTextAnimationPreset(
      update.keyframes, clip.x, clip.y, 0, undefined, clip.width, clip.height, 5000, clip.fontSize, true
    )).toBe('Zoom In');
  });

  it('clamps exit keyframes for clips shorter than the exit window', () => {
    const update = buildTextAnimationUpdate(presetByName('Spin Out'), {
      startMs: 0, endMs: 400, rotation: 0,
    });
    expect(update.keyframes?.map((frame) => frame.tMs)).toEqual([0, 400]);
  });

  it('re-anchors a matched exit when the clip duration changes', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'text');
    const track = (store.getState().doc.outputs[0] as any).tracks.find((item: any) => item.type === 'text');
    const clip = {
      id: 'clip-exit', startMs: 0, endMs: 3000, text: 'Exit', x: 0, y: 0,
      width: 200, height: 100, fontSize: 24,
    };
    store.getState().addClip(0, track.id, clip);
    store.getState().updateClipSilent(0, track.id, clip.id,
      buildTextAnimationUpdate(presetByName('Fade Out'), clip)
    );

    store.getState().updateClipSilent(0, track.id, clip.id, { endMs: 6000 });

    const updated = (store.getState().doc.outputs[0] as any).tracks
      .find((item: any) => item.id === track.id).clips[0];
    expect(updated.keyframes.map((frame: any) => frame.tMs)).toEqual([5500, 6000]);
    expect(updated.keyframes[1].props.opacity).toBe(0);
  });

  it('covers entrance, emphasis, and exit categories', () => {
    expect(new Set(TEXT_ANIMATION_PRESETS.map((preset) => preset.category))).toEqual(
      new Set(['entrance', 'emphasis', 'exit'])
    );
    expect(presetByName('Pulse').category).toBe('emphasis');
    expect(presetByName('Spin Out').category).toBe('exit');
  });

  it('composes and matches independent entrance, emphasis, and exit presets', () => {
    const base = {
      x: 100, y: 200, width: 200, height: 100, rotation: 0,
      text: 'Combined', startMs: 0, endMs: 5000, keyframes: [],
    };
    const combined = ['Fade Up', 'Pulse', 'Fade Out'].reduce(
      (clip, name) => ({ ...clip, ...buildTextAnimationUpdate(presetByName(name), clip) }),
      base
    );

    expect(matchTextAnimationPresets(combined)).toEqual({
      entrance: 'Fade Up',
      emphasis: 'Pulse',
      exit: 'Fade Out',
    });
    expect(combined.keyframes.map((frame) => frame.tMs)).toEqual([0, 300, 500, 600, 4500, 5000]);
  });

  it('replaces only the selected category', () => {
    const base = { x: 100, y: 200, width: 200, height: 100, startMs: 0, endMs: 5000, keyframes: [] };
    const original = ['Fade Up', 'Pulse', 'Fade Out'].reduce(
      (clip, name) => ({ ...clip, ...buildTextAnimationUpdate(presetByName(name), clip) }),
      base
    );
    const replaced = {
      ...original,
      ...buildTextAnimationUpdate(presetByName('Slide In Right'), original),
    };

    expect(matchTextAnimationPresets(replaced)).toEqual({
      entrance: 'Slide In Right',
      emphasis: 'Pulse',
      exit: 'Fade Out',
    });
    expect(replaced.keyframes.find((frame) => frame.tMs === 0)?.props.y).toBeUndefined();
    expect(replaced.keyframes.find((frame) => frame.tMs === 500)?.props.y).toBeUndefined();
    expect(replaced.keyframes.find((frame) => frame.tMs === 300)?.props.width).toBe(216);
    expect(replaced.keyframes.find((frame) => frame.tMs === 5000)?.props.opacity).toBe(0);
  });

  it('keeps emphasis and exit when switching between Typewriter and a keyframe entrance', () => {
    const base = { x: 0, y: 0, width: 100, height: 50, text: 'Hello', startMs: 0, endMs: 5000, keyframes: [] };
    const withOtherCategories = ['Pulse', 'Fade Out'].reduce(
      (clip, name) => ({ ...clip, ...buildTextAnimationUpdate(presetByName(name), clip) }),
      base
    );
    const revealed = {
      ...withOtherCategories,
      ...buildTextAnimationUpdate(presetByName('Typewriter'), withOtherCategories),
    };

    expect(matchTextAnimationPresets(revealed)).toEqual({
      entrance: 'Typewriter',
      emphasis: 'Pulse',
      exit: 'Fade Out',
    });
    expect(revealed.keyframes).toHaveLength(5);

    const popped = {
      ...revealed,
      ...buildTextAnimationUpdate(presetByName('Pop'), revealed),
    };
    expect(popped.textReveal).toBeUndefined();
    expect(matchTextAnimationPresets(popped)).toEqual({
      entrance: 'Pop',
      emphasis: 'Pulse',
      exit: 'Fade Out',
    });
  });

  it('preserves unrelated manual keyframes while applying and replacing presets', () => {
    const base = {
      x: 0, y: 0, width: 100, height: 50, startMs: 0, endMs: 5000,
      keyframes: [{ tMs: 1200, props: { x: 999 } }],
    };
    const entrance = { ...base, ...buildTextAnimationUpdate(presetByName('Fade Up'), base) };
    const replaced = { ...entrance, ...buildTextAnimationUpdate(presetByName('Pop'), entrance) };

    expect(replaced.keyframes).toContainEqual({ tMs: 1200, props: { x: 999 } });
    expect(matchTextAnimationPresets(replaced).entrance).toBe('Pop');
  });

  it('re-anchors only the exit when a combined clip duration changes', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'text');
    const track = (store.getState().doc.outputs[0] as any).tracks.find((item: any) => item.type === 'text');
    const clip = {
      id: 'clip-combined', startMs: 0, endMs: 5000, text: 'Combined', x: 0, y: 0,
      width: 200, height: 100, fontSize: 24, keyframes: [],
    };
    store.getState().addClip(0, track.id, clip);
    for (const name of ['Fade Up', 'Pulse', 'Fade Out']) {
      const current = (store.getState().doc.outputs[0] as any).tracks
        .find((item: any) => item.id === track.id).clips[0];
      store.getState().updateClipSilent(0, track.id, clip.id,
        buildTextAnimationUpdate(presetByName(name), current, true)
      );
    }

    store.getState().updateClipSilent(0, track.id, clip.id, { endMs: 7000 });

    const updated = (store.getState().doc.outputs[0] as any).tracks
      .find((item: any) => item.id === track.id).clips[0];
    expect(matchTextAnimationPresets(updated, true)).toEqual({
      entrance: 'Fade Up',
      emphasis: 'Pulse',
      exit: 'Fade Out',
    });
    expect(updated.keyframes.map((frame: any) => frame.tMs)).toEqual([0, 300, 500, 600, 6500, 7000]);
  });
});
