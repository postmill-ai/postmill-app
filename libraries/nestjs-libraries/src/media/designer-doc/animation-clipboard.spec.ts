import { describe, expect, it } from 'vitest';
import type { VideoClip, VideoTrack } from './designer-doc.schema';
import { planAnimationPaste, snapshotAnimation } from './animation-clipboard';

const clip = (values: Partial<VideoClip> = {}): VideoClip => ({
  id: 'clip',
  startMs: 0,
  endMs: 4000,
  ...values,
});

const sourceTrack = { type: 'text' } as Pick<VideoTrack, 'type'>;

const animatedSource = () => clip({
  id: 'source',
  text: 'source content',
  src: 'https://assets.example/source.mp4',
  fileId: 'source-file',
  originalFileId: 'source-original',
  maskFileId: 'source-mask',
  originId: 'source-origin',
  groupId: 'source-group',
  x: 100,
  y: 200,
  width: 200,
  height: 100,
  rotation: 10,
  fontSize: 20,
  keyframes: [
    {
      tMs: 0,
      props: { x: 100, y: 200, width: 200, height: 100, rotation: 10, opacity: 0, fontSize: 20, volume: 0.4 },
      ease: { in: [0.2, 0.1], out: [0.3, 0.4] },
    },
    {
      tMs: 1000,
      props: { x: 140, y: 180, width: 100, height: 200, rotation: 25, opacity: 1, fontSize: 40 },
    },
  ],
});

describe('snapshotAnimation', () => {
  it('allowlists animation data, reports audio, and deep-clones every nested value', () => {
    const source = animatedSource();
    const { snapshot, skipped } = snapshotAnimation(sourceTrack, source);
    expect(skipped).toEqual(['audio']);
    expect(snapshot).toMatchObject({
      sourceType: 'text',
      durationMs: 4000,
      base: { x: 100, y: 200, width: 200, height: 100, rotation: 10, fontSize: 20 },
    });
    expect(snapshot?.keyframes).toHaveLength(2);
    expect(snapshot?.keyframes[0].props).not.toHaveProperty('volume');
    expect(JSON.stringify(snapshot)).not.toContain('source-file');
    expect(JSON.stringify(snapshot)).not.toContain('source content');
    expect(JSON.stringify(snapshot)).not.toContain('assets.example');

    source.keyframes![0].props.x = 999;
    (source.keyframes![0].ease as { out: [number, number] }).out[0] = 0.99;
    expect(snapshot?.keyframes[0].props.x).toBe(100);
    expect(snapshot?.keyframes[0].ease).toEqual({ in: [0.2, 0.1], out: [0.3, 0.4] });
  });

  it('copies reveal-only and path-only animation without requiring keyframes', () => {
    const reveal = snapshotAnimation(sourceTrack, clip({ textReveal: { mode: 'chars', durationMs: 800 } }));
    expect(reveal.snapshot?.textReveal).toEqual({ mode: 'chars', durationMs: 800 });

    const path = snapshotAnimation(sourceTrack, clip({
      motionPath: { points: [{ x: 0, y: 0, tMs: 0 }, { x: 20, y: 30, tMs: 4000 }] },
    }));
    expect(path.snapshot?.motionPath?.points).toHaveLength(2);
  });

  it('clears unsupported-only snapshots and identifies their skipped channels', () => {
    expect(snapshotAnimation(sourceTrack, clip({
      keyframes: [{ tMs: 0, props: { volume: 0.5 } }],
    }))).toEqual({ snapshot: null, skipped: ['audio'] });
    expect(snapshotAnimation({ type: 'audio' }, clip({
      keyframes: [{ tMs: 0, props: { opacity: 0.5 } }],
    })).skipped).toEqual(['audio-clip']);
    expect(snapshotAnimation(sourceTrack, clip({
      keyframes: [{ tMs: 0, props: { custom: 1 } }],
    })).skipped).toEqual(['unsupported-properties']);
  });

  it('rejects inert or invalid motion paths', () => {
    const { snapshot, skipped } = snapshotAnimation(sourceTrack, clip({
      motionPath: { points: [{ x: 0, y: 0, tMs: 0 }] },
    }));
    expect(snapshot).toBeNull();
    expect(skipped).toEqual(['invalid-path']);
  });
});

describe('planAnimationPaste', () => {
  it('normalizes timing and remaps position, size, rotation, and type relative to each target', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, animatedSource());
    const target = clip({
      id: 'target',
      startMs: 2000,
      endMs: 4000,
      text: 'target content',
      src: 'target-file',
      fileId: 'target-file-id',
      originId: 'target-origin',
      groupId: 'target-group',
      x: 500,
      y: 600,
      width: 400,
      height: 50,
      rotation: -5,
      fontSize: 10,
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      focalPoint: { x: 0.4, y: 0.5 },
      speed: 2,
      speedCurve: [{ atMs: 0, speed: 1 }, { atMs: 1000, speed: 2 }],
      volume: 0.8,
      fadeInMs: 100,
      fadeOutMs: 200,
      keyframes: [{ tMs: 250, props: { volume: 0.7, x: 999 }, ease: 'easeIn' }],
    });
    const [plan] = planAnimationPaste(snapshot!, [{ track: sourceTrack, clip: target }]);

    expect(plan.skipped).toEqual([]);
    expect(plan.patch?.keyframes).toEqual([
      {
        tMs: 0,
        props: { x: 500, y: 600, width: 400, height: 50, rotation: -5, opacity: 0, fontSize: 10 },
        ease: { in: [0.2, 0.1], out: [0.3, 0.4] },
      },
      { tMs: 250, props: { volume: 0.7 }, ease: 'easeIn' },
      {
        tMs: 500,
        props: { x: 540, y: 580, width: 200, height: 100, rotation: 10, opacity: 1, fontSize: 20 },
      },
    ]);
    expect(target).toMatchObject({
      startMs: 2000,
      endMs: 4000,
      text: 'target content',
      src: 'target-file',
      fileId: 'target-file-id',
      originId: 'target-origin',
      groupId: 'target-group',
      x: 500,
      y: 600,
      width: 400,
      height: 50,
      rotation: -5,
      fontSize: 10,
      volume: 0.8,
      fadeInMs: 100,
      fadeOutMs: 200,
      speed: 2,
    });
    expect(plan.patch).not.toHaveProperty('startMs');
    expect(plan.patch).not.toHaveProperty('src');
    expect(plan.patch).not.toHaveProperty('crop');
    expect(plan.patch).not.toHaveProperty('speedCurve');

    plan.patch!.keyframes![0].props.x = 12345;
    expect(snapshot?.keyframes[0].props.x).toBe(100);
  });

  it('replaces old visual channels instead of merging them, while retaining target audio', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, clip({
      keyframes: [{ tMs: 0, props: { opacity: 0.5 } }],
    }));
    const [plan] = planAnimationPaste(snapshot!, [{
      track: sourceTrack,
      clip: clip({
        textReveal: { mode: 'words' },
        motionPath: { points: [{ x: 0, y: 0, tMs: 0 }, { x: 10, y: 10, tMs: 100 }] },
        keyframes: [
          { tMs: 0, props: { x: 200, rotation: 20 } },
          { tMs: 100, props: { volume: 0.25 } },
        ],
      }),
    }]);
    expect(plan.patch).toEqual({
      keyframes: [
        { tMs: 0, props: { opacity: 0.5 } },
        { tMs: 100, props: { volume: 0.25 } },
      ],
      motionPath: undefined,
      textReveal: undefined,
    });
  });

  it('re-anchors and rescales KAN-16 paths while preserving path-local movement and rotation', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, clip({
      x: 100,
      y: 200,
      width: 200,
      height: 100,
      motionPath: {
        points: [{ x: 200, y: 250, tMs: 0 }, { x: 260, y: 310, tMs: 4000 }],
        ease: 'easeInOut',
        followRotation: true,
        timeOffsetMs: 1000,
        timeDurationMs: 4000,
        startDx: 12,
        startDy: -8,
        startRotation: 15,
        startAngle: 45,
      },
    }));
    const [plan] = planAnimationPaste(snapshot!, [{
      track: { type: 'image' },
      clip: clip({ startMs: 1000, endMs: 3000, x: 500, y: 600, width: 400, height: 50 }),
    }]);
    expect(plan.patch?.motionPath).toEqual({
      points: [{ x: 700, y: 625, tMs: 0 }, { x: 760, y: 685, tMs: 2000 }],
      ease: 'easeInOut',
      followRotation: true,
      timeOffsetMs: 500,
      timeDurationMs: 2000,
      startDx: 12,
      startDy: -8,
      startRotation: 15,
      startAngle: 45,
    });
    plan.patch!.motionPath!.points[0].x = 0;
    expect(snapshot?.motionPath?.points[0].x).toBe(200);
  });

  it('rescales text reveal and skips it with a summary on incompatible targets', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, clip({
      textReveal: { mode: 'words', durationMs: 1000 },
    }));
    const [text, image, caption] = planAnimationPaste(snapshot!, [
      { track: { type: 'text' }, clip: clip({ id: 'text', startMs: 0, endMs: 2000 }) },
      { track: { type: 'image' }, clip: clip({ id: 'image', startMs: 0, endMs: 2000 }) },
      { track: { type: 'caption' }, clip: clip({ id: 'caption', startMs: 0, endMs: 2000 }) },
    ]);
    expect(text.patch?.textReveal).toEqual({ mode: 'words', durationMs: 500 });
    expect(image.patch).toBeUndefined();
    expect(image.skipped).toEqual(['text-reveal', 'no-compatible-animation']);
    expect(caption.patch).toBeUndefined();
    expect(caption.skipped).toEqual(['text-reveal', 'no-compatible-animation']);
  });

  it('copies compatible channels and reports font-size and invalid-base skips', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, clip({
      width: 0,
      keyframes: [{ tMs: 0, props: { x: 20, width: 100, fontSize: 30 } }],
    }));
    const [plan] = planAnimationPaste(snapshot!, [{
      track: { type: 'shape' },
      clip: clip({ x: 100, width: 300 }),
    }]);
    expect(plan.patch?.keyframes).toEqual([{ tMs: 0, props: { x: 120 } }]);
    expect(plan.skipped).toEqual(['invalid-base', 'font-size']);
  });

  it('rejects audio and targets with no compatible source channel without a patch', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, clip({
      keyframes: [{ tMs: 0, props: { fontSize: 30 } }],
    }));
    const plans = planAnimationPaste(snapshot!, [
      { track: { type: 'audio' }, clip: clip({ id: 'audio' }) },
      { track: { type: 'image' }, clip: clip({ id: 'image' }) },
    ]);
    expect(plans[0].patch).toBeUndefined();
    expect(plans[0].skipped).toContain('audio-clip');
    expect(plans[1].patch).toBeUndefined();
    expect(plans[1].skipped).toEqual(['font-size', 'no-compatible-animation']);
  });

  it('copies common visual channels across every visual source and target type', () => {
    const types = ['text', 'caption', 'shape', 'image', 'sticker', 'raster', 'video'] as const;
    for (const sourceType of types) {
      const { snapshot } = snapshotAnimation({ type: sourceType }, clip({
        keyframes: [
          { tMs: 0, props: { opacity: 0 } },
          { tMs: 4000, props: { opacity: 1 } },
        ],
      }));
      expect(snapshot).not.toBeNull();
      for (const targetType of types) {
        const [plan] = planAnimationPaste(snapshot!, [{
          track: { type: targetType },
          clip: clip({ startMs: 1000, endMs: 3000 }),
        }]);
        expect(plan.patch?.keyframes).toEqual([
          { tMs: 0, props: { opacity: 0 } },
          { tMs: 2000, props: { opacity: 1 } },
        ]);
      }
    }
  });

  it('refuses a patch that would exceed the document keyframe cap', () => {
    const { snapshot } = snapshotAnimation(sourceTrack, clip({
      keyframes: Array.from({ length: 1000 }, (_, index) => ({
        tMs: index,
        props: { opacity: index / 1000 },
      })),
    }));
    const [plan] = planAnimationPaste(snapshot!, [{
      track: { type: 'image' },
      clip: clip({ keyframes: [{ tMs: 4000, props: { volume: 0.5 } }] }),
    }]);
    expect(plan.patch).toBeUndefined();
    expect(plan.skipped).toEqual(['keyframe-limit', 'no-compatible-animation']);
  });
});
