import { describe, it, expect } from 'vitest';
import {
  imageDocToVideoDoc,
  imageOutputToVideo,
} from './image-doc-to-video';
import type {
  DesignerDoc,
  DesignerOutput,
  VideoOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { StrictVideoOutputSchema } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { SymbolDefinition } from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_VIDEO_DURATION_MS,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type { ChannelPreset } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

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
  it('takes canvas dims and fps from the channel preset, duration defaults to 10 s under the preset cap', () => {
    const vo = imageOutputToVideo(makeOutput());
    const preset = CHANNEL_PRESETS.find((p) => p.id === 'reel')!;
    expect(vo.width).toBe(preset.width);
    expect(vo.height).toBe(preset.height);
    expect(vo.fps).toBe(preset.fps);
    // maxDurationMs (60000) is a hard cap, not the default session length.
    expect(vo.durationMs).toBe(10000);
    expect(vo.durationMs).toBeLessThanOrEqual(MAX_VIDEO_DURATION_MS);
  });

  it('lets a preset duration cap below the 10 s default bind', () => {
    const tiny: ChannelPreset = {
      id: 'tiny-cap-video',
      name: 'Tiny Cap Video',
      width: 100,
      height: 100,
      category: 'video',
      provider: null,
      fps: 30,
      maxDurationMs: 4000,
    };
    CHANNEL_PRESETS.push(tiny);
    try {
      const vo = imageOutputToVideo(makeOutput({ formatId: 'tiny-cap-video' }));
      expect(vo.durationMs).toBe(4000);
    } finally {
      CHANNEL_PRESETS.splice(CHANNEL_PRESETS.indexOf(tiny), 1);
    }
  });

  it('falls back to the output dims and defaults for unknown formats', () => {
    const vo = imageOutputToVideo(
      makeOutput({ formatId: 'custom-700x500', width: 700, height: 500 })
    );
    expect(vo.width).toBe(700);
    expect(vo.height).toBe(500);
    expect(vo.fps).toBe(30);
    expect(vo.durationMs).toBe(10000);
  });

  it('carries a color background onto the video output bg instead of a rect clip', () => {
    const vo = imageOutputToVideo(makeOutput({ background: '#ff0000' }));
    expect(vo.bg).toEqual({ type: 'color', color: '#ff0000' });
    // No flat-color rect shape clip is injected for the background.
    expect(vo.tracks).toHaveLength(0);
  });

  it('carries a gradient background onto bg with its stops preserved', () => {
    const gradient = {
      type: 'linear' as const,
      angle: 45,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    const vo = imageOutputToVideo(makeOutput({ bg: { type: 'gradient', gradient } }));
    expect(vo.bg).toEqual({ type: 'gradient', gradient });
    expect(vo.bg?.type === 'gradient' && vo.bg.gradient?.stops).toHaveLength(3);
    expect(vo.tracks).toHaveLength(0);
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
    // The color background rides on bg; imagery, shapes, text follow bottom-up.
    expect(vo.bg).toEqual({ type: 'color', color: '#112233' });
    expect(types).toEqual(['image', 'shape', 'text']);

    const imageClip = vo.tracks[0].clips[0];
    expect(imageClip.src).toBe('https://cdn.example.com/a.png');
    expect(imageClip.fileId).toBe('file-a');
    expect(imageClip.endMs).toBe(vo.durationMs);

    const shapeClip = vo.tracks[1].clips[0];
    expect(shapeClip.shape).toBe('star');
    expect(shapeClip.sides).toBe(5);

    const textClip = vo.tracks[2].clips[0];
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
    // Nothing survives as a clip; the color background rides on bg.
    expect(vo.tracks).toHaveLength(0);
    expect(vo.bg).toEqual({ type: 'color', color: '#112233' });
  });

  it('expands a CTA lockup symbol into shape + text clips, plate under label', () => {
    const lockup: SymbolDefinition = {
      id: 'lockup-cta',
      name: 'CTA',
      width: 300,
      height: 90,
      children: [
        {
          id: 'plate',
          type: 'shape',
          shape: 'rect',
          x: 0,
          y: 0,
          width: 300,
          height: 90,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          fill: '#ff6600',
          borderRadius: 45,
        },
        {
          id: 'label',
          type: 'text',
          text: 'Shop now',
          x: 0,
          y: 20,
          width: 300,
          height: 50,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          fontSize: 32,
          fill: '#ffffff',
        },
      ] as SymbolDefinition['children'],
    };
    const doc: DesignerDoc = {
      version: 7,
      mode: 'image',
      symbols: [lockup],
      outputs: [
        makeOutput({
          children: [
            {
              id: 'cta',
              type: 'symbol',
              symbolId: 'lockup-cta',
              symbolOverrides: { label: { text: 'Buy now' } },
              x: 100,
              y: 200,
              width: 300,
              height: 90,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
            },
          ] as DesignerOutput['children'],
        }),
      ],
    };

    // The doc-level entry point threads doc.symbols through to the mapper.
    const vo = imageDocToVideoDoc(doc).outputs[0] as VideoOutput;
    const shapeTrack = vo.tracks.find((t) => t.type === 'shape')!;
    const textTrack = vo.tracks.find((t) => t.type === 'text')!;

    const plate = shapeTrack.clips[0];
    expect(plate.shape).toBe('rect');
    expect(plate.fill).toBe('#ff6600');
    // The instance's box positions the expanded plate (scale 1 here).
    expect(plate.x).toBe(100);
    expect(plate.y).toBe(200);

    const label = textTrack.clips[0];
    // The instance's text override wins over the definition's authored copy.
    expect(label.text).toBe('Buy now');
    expect(label.y).toBe(220);

    const parsed = StrictVideoOutputSchema.safeParse(vo);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it('maps group members linked by parentId, and drops members of a hidden group', () => {
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
          { ...base, id: 'g', type: 'group', hidden: false },
          { ...base, id: 't1', type: 'text', hidden: false, text: 'member', parentId: 'g' },
          { ...base, id: 'g2', type: 'group', hidden: true },
          { ...base, id: 't2', type: 'text', hidden: false, text: 'ghost', parentId: 'g2' },
        ] as DesignerOutput['children'],
      })
    );
    // The group containers themselves still have no clip counterpart; the
    // visible member lands, the hidden group's member goes with its group.
    const textTrack = vo.tracks.find((t) => t.type === 'text')!;
    expect(textTrack.clips.map((c) => c.text)).toEqual(['member']);
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
    // The strict schema declares bg, so validation keeps it rather than
    // rejecting the key or stripping it.
    expect(parsed.success && (parsed.data as VideoOutput).bg).toEqual({
      type: 'color',
      color: '#112233',
    });
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

  it('threads onDropped through to each converted output', () => {
    const doc: DesignerDoc = {
      version: 7,
      mode: 'image',
      outputs: [
        makeOutput({
          children: [
            {
              id: 'i1',
              type: 'icon',
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
            },
          ] as DesignerOutput['children'],
        }),
        makeOutput({ id: 'out-2', formatId: 'landscape-video' }),
      ],
    };
    const dropped: [string, string[]][] = [];
    imageDocToVideoDoc(doc, {
      onDropped: (formatId, types) => dropped.push([formatId, types]),
    });
    expect(dropped).toEqual([['reel', ['icon']]]);
  });
});

describe('entrance staggering and element porting', () => {
  const el = (
    id: string,
    type: string,
    extra: Record<string, unknown> = {}
  ) =>
    ({
      id,
      type,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      ...extra,
    }) as DesignerOutput['children'][number];

  it('staggers text clip entrances (0, 350, 700…) and keeps full-length tails', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          el('t1', 'text', { text: 'one' }),
          el('t2', 'text', { text: 'two' }),
          el('t3', 'text', { text: 'three' }),
        ],
      })
    );
    const track = vo.tracks.find((t) => t.type === 'text')!;
    expect(track.clips.map((c) => c.startMs)).toEqual([0, 350, 700]);
    // Every clip still runs to the end of the timeline.
    expect(track.clips.every((c) => c.endMs === vo.durationMs)).toBe(true);
    // The fade-in survives the stagger.
    expect(track.clips[1].transitionIn).toEqual({ type: 'fade', durationMs: 400 });
  });

  it('staggers shape clip entrances and gives shapes a fade-in', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          el('s1', 'shape', { shape: 'rect', fill: '#000000' }),
          el('s2', 'shape', { shape: 'ellipse', fill: '#111111' }),
        ],
      })
    );
    const track = vo.tracks.find((t) => t.type === 'shape')!;
    expect(track.clips.map((c) => c.startMs)).toEqual([0, 350]);
    expect(track.clips[0].transitionIn).toEqual({ type: 'fade', durationMs: 300 });
  });

  it('caps the stagger so a late clip keeps on-screen time', () => {
    const children = Array.from({ length: 40 }, (_, i) =>
      el(`t${i}`, 'text', { text: `line ${i}` })
    );
    const vo = imageOutputToVideo(makeOutput({ children }));
    const track = vo.tracks.find((t) => t.type === 'text')!;
    for (const clip of track.clips) {
      expect(clip.endMs - clip.startMs).toBeGreaterThanOrEqual(500);
    }
  });

  it('ports raster elements onto a raster track without Ken Burns keyframes', () => {
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          el('r1', 'raster', { src: 'https://cdn.example.com/baked.png', fileId: 'rf1' }),
        ],
      })
    );
    const track = vo.tracks.find((t) => t.type === 'raster')!;
    expect(track.clips[0].src).toBe('https://cdn.example.com/baked.png');
    expect(track.clips[0].fileId).toBe('rf1');
    expect(track.clips[0].keyframes).toBeUndefined();
    const parsed = StrictVideoOutputSchema.safeParse(vo);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it('reports icon/path/fill/adjustment drops via onDropped instead of losing them silently', () => {
    const dropped: [string, string[]][] = [];
    const vo = imageOutputToVideo(
      makeOutput({
        children: [
          el('i1', 'icon'),
          el('p1', 'path'),
          el('f1', 'fill'),
          el('a1', 'adjustment'),
          el('t1', 'text', { text: 'kept' }),
        ],
      }),
      { onDropped: (formatId, types) => dropped.push([formatId, types]) }
    );
    expect(dropped).toEqual([['reel', ['icon', 'path', 'fill', 'adjustment']]]);
    // The portable elements still land.
    expect(vo.tracks.find((t) => t.type === 'text')!.clips).toHaveLength(1);
  });

  it('does not call onDropped when nothing was lost', () => {
    const onDropped = () => {
      throw new Error('must not be called');
    };
    imageOutputToVideo(
      makeOutput({ children: [el('t1', 'text', { text: 'kept' })] }),
      { onDropped }
    );
  });
});
