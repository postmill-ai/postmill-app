import { describe, it, expect } from 'vitest';
import {
  imageDocToVideoDoc,
  imageOutputToVideo,
} from './image-doc-to-video';
import type {
  DesignerDoc,
  DesignerOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { StrictVideoOutputSchema } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_VIDEO_DURATION_MS,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

const makeOutput = (
  overrides: Partial<DesignerOutput> = {}
): DesignerOutput => ({
  id: 'out-1',
  formatId: 'reel',
  name: 'Instagram Reel (Video)',
  width: 1080,
  height: 1920,
  background: '#112233',
  children: [],
  ...overrides,
});

describe('imageOutputToVideo', () => {
  it('takes canvas dims, fps and duration from the channel preset', () => {
    const vo = imageOutputToVideo(makeOutput());
    const preset = CHANNEL_PRESETS.find((p) => p.id === 'reel')!;
    expect(vo.width).toBe(preset.width);
    expect(vo.height).toBe(preset.height);
    expect(vo.fps).toBe(preset.fps);
    expect(vo.durationMs).toBe(preset.maxDurationMs);
    expect(vo.durationMs).toBeLessThanOrEqual(MAX_VIDEO_DURATION_MS);
  });

  it('falls back to the output dims and defaults for unknown formats', () => {
    const vo = imageOutputToVideo(
      makeOutput({ formatId: 'custom-700x500', width: 700, height: 500 })
    );
    expect(vo.width).toBe(700);
    expect(vo.height).toBe(500);
    expect(vo.fps).toBe(30);
    expect(vo.durationMs).toBe(5000);
  });

  it('maps a color background to a full-canvas rect shape clip', () => {
    const vo = imageOutputToVideo(makeOutput({ background: '#ff0000' }));
    expect(vo.tracks[0].type).toBe('shape');
    const clip = vo.tracks[0].clips[0];
    expect(clip.shape).toBe('rect');
    expect(clip.fill).toBe('#ff0000');
    expect(clip.width).toBe(vo.width);
    expect(clip.height).toBe(vo.height);
    expect(clip.startMs).toBe(0);
    expect(clip.endMs).toBe(vo.durationMs);
  });

  it('maps an image background to a bottom-most full-canvas image clip', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        bg: { type: 'image', src: 'https://cdn.example.com/bg.png', fileId: 'bg-file' },
      })
    );
    expect(vo.tracks[0].type).toBe('image');
    const clip = vo.tracks[0].clips[0];
    expect(clip.src).toBe('https://cdn.example.com/bg.png');
    expect(clip.fileId).toBe('bg-file');
    expect(clip.fitMode).toBe('cover');
    // Ken Burns: a two-keyframe slow zoom over the full duration.
    expect(clip.keyframes).toHaveLength(2);
    expect(clip.keyframes![1].tMs).toBe(vo.durationMs);
    expect(clip.keyframes![1].props.width!).toBeGreaterThan(
      clip.keyframes![0].props.width!
    );
  });

  it('maps image, shape and text elements onto per-type tracks in z-order', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          {
            id: 'e1',
            type: 'image',
            x: 10,
            y: 20,
            width: 400,
            height: 300,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            src: 'https://cdn.example.com/a.png',
            fileId: 'file-a',
          },
          {
            id: 'e2',
            type: 'shape',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            shape: 'star',
            sides: 5,
            fill: '#00ff00',
          },
          {
            id: 'e3',
            type: 'text',
            x: 50,
            y: 60,
            width: 500,
            height: 120,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'Hello video',
            fontFamily: 'Inter',
            fontSize: 64,
            fill: '#ffffff',
          },
        ] as DesignerOutput['children'],
      })
    );

    const types = vo.tracks.map((t) => t.type);
    // Color background shape track first, then imagery, shapes, text on top.
    expect(types).toEqual(['shape', 'image', 'shape', 'text']);

    const imageClip = vo.tracks[1].clips[0];
    expect(imageClip.src).toBe('https://cdn.example.com/a.png');
    expect(imageClip.fileId).toBe('file-a');
    expect(imageClip.endMs).toBe(vo.durationMs);

    const shapeClip = vo.tracks[2].clips[0];
    expect(shapeClip.shape).toBe('star');
    expect(shapeClip.sides).toBe(5);

    const textClip = vo.tracks[3].clips[0];
    expect(textClip.text).toBe('Hello video');
    expect(textClip.fontFamily).toBe('Inter');
    expect(textClip.transitionIn).toEqual({ type: 'fade', durationMs: 400 });
  });

  it('skips hidden elements and types with no clip counterpart', () => {
    const base = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
    };
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          { ...base, id: 'h', type: 'text', hidden: true, text: 'secret' },
          { ...base, id: 'i', type: 'icon', hidden: false },
          { ...base, id: 'g', type: 'group', hidden: false },
        ] as DesignerOutput['children'],
      })
    );
    // Only the color-background shape clip survives.
    expect(vo.tracks).toHaveLength(1);
    expect(vo.tracks[0].clips).toHaveLength(1);
    expect(vo.tracks[0].clips[0].shape).toBe('rect');
  });

  it('omits Ken Burns keyframes when disabled', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          {
            id: 'e1',
            type: 'image',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            src: 'https://cdn.example.com/a.png',
          },
        ] as DesignerOutput['children'],
      }),
      { kenBurns: false }
    );
    const imageTrack = vo.tracks.find((t) => t.type === 'image')!;
    expect(imageTrack.clips[0].keyframes).toBeUndefined();
  });

  it('caps clips per track at MAX_CLIPS_PER_TRACK', () => {
    const children = Array.from({ length: MAX_CLIPS_PER_TRACK + 5 }, (_, i) => ({
      id: `t${i}`,
      type: 'text' as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text: `line ${i}`,
    }));
    const vo = imageOutputToVideo(makeOutput({ children }));
    const textTrack = vo.tracks.find((t) => t.type === 'text')!;
    expect(textTrack.clips).toHaveLength(MAX_CLIPS_PER_TRACK);
  });

  it('produces outputs that pass the strict video schema', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          {
            id: 'e1',
            type: 'image',
            x: 10,
            y: 20,
            width: 400,
            height: 300,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            src: 'https://cdn.example.com/a.png',
            fileId: 'file-a',
          },
          {
            id: 'e2',
            type: 'text',
            x: 50,
            y: 60,
            width: 500,
            height: 120,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'Schema check',
            fontSize: 64,
          },
        ] as DesignerOutput['children'],
      })
    );
    const parsed = StrictVideoOutputSchema.safeParse(vo);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });
});

describe('imageDocToVideoDoc', () => {
  it('flips the doc to video mode, converting every output', () => {
    const doc: DesignerDoc = {
      version: 7,
      mode: 'image',
      outputs: [
        makeOutput(),
        makeOutput({ id: 'out-2', formatId: 'landscape-video', name: 'Landscape Video', width: 1920, height: 1080 }),
      ],
    };
    const videoDoc = imageDocToVideoDoc(doc);
    expect(videoDoc.mode).toBe('video');
    expect(videoDoc.version).toBe(7);
    expect(videoDoc.outputs).toHaveLength(2);
    expect((videoDoc.outputs[1] as any).fps).toBe(30);
    expect((videoDoc.outputs[1] as any).tracks).toBeDefined();
  });
});
