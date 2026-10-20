import { describe, it, expect, vi } from 'vitest';
import {
  DesignerDocLenientSchema,
  DesignerDocStrictSchema,
  ColorSchema,
  SrcSchema,
  DesignerFilterStringSchema,
  CLIP_BLEND_MODES,
} from './designer-doc.schema';
import { migrateDoc } from './designer-doc.migrate';
import {
  MAX_DIMENSION,
  MAX_ELEMENTS_PER_OUTPUT,
  MAX_FONT_SIZE,
  MAX_INLINE_SRC_LEN,
  MAX_VIDEO_DURATION_MS,
} from './designer-doc.limits';

const imageDocFixture = {
  version: 2,
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'instagram-feed',
      name: 'Instagram Feed',
      width: 1080,
      height: 1080,
      background: '#ffffff',
      bg: {
        type: 'image' as const,
        src: 'http://localhost:3000/uploads/test.png',
        fileId: 'file-1',
      },
      children: [
        {
          id: 'el-1',
          type: 'text' as const,
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          text: 'Hello',
          fontSize: 24,
          fill: '#000000',
        },
        {
          id: 'el-2',
          type: 'image' as const,
          x: 0,
          y: 0,
          width: 1080,
          height: 1080,
          rotation: 0,
          opacity: 0.8,
          locked: false,
          hidden: false,
          src: 'data:image/png;base64,abc',
          fileId: 'file-2',
          filters: ['brightness:1.2'],
          boxShadow: {
            color: '#000000',
            blur: 10,
            offsetX: 2,
            offsetY: 2,
          },
        },
      ],
    },
  ],
  attribution: {
    source: 'unsplash',
    author: 'Jane Doe',
  },
};

const videoDocFixture = {
  version: 2,
  mode: 'video',
  outputs: [
    {
      id: 'out-v1',
      formatId: 'reels',
      name: 'Reels',
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 15000,
      tracks: [
        {
          id: 'trk-1',
          type: 'video' as const,
          clips: [
            {
              id: 'clip-1',
              startMs: 0,
              endMs: 15000,
              src: 'https://example.com/clip.mp4',
              fontWeight: 700,
            },
          ],
        },
      ],
    },
  ],
};

describe('DesignerDoc schema', () => {
  it('parses a valid image doc leniently and preserves values', () => {
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(imageDocFixture));
    expect(parsed.outputs[0].width).toBe(1080);
    expect(parsed.outputs[0].children[1].boxShadow?.blur).toBe(10);
    expect(parsed.outputs[0].bg?.src).toBe('http://localhost:3000/uploads/test.png');
    expect(parsed.attribution?.author).toBe('Jane Doe');
  });

  it('parses a valid video doc leniently', () => {
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(videoDocFixture));
    expect(parsed.mode).toBe('video');
    expect(parsed.outputs[0].tracks[0].clips[0].fontWeight).toBe(700);
  });

  it('round-trips voiceover provenance with tone instructions and provider pin', () => {
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].clips[0].voiceover = {
      script: 'Hello world',
      voice: 'alloy',
      instructions: 'warm and conversational',
      provider: 'openai',
    };
    for (const schema of [DesignerDocLenientSchema, DesignerDocStrictSchema]) {
      const parsed = schema.parse(migrateDoc(doc));
      expect(parsed.outputs[0].tracks[0].clips[0].voiceover).toEqual({
        script: 'Hello world',
        voice: 'alloy',
        instructions: 'warm and conversational',
        provider: 'openai',
      });
    }
  });

  it('drops non-finite keyframe props in lenient mode instead of rejecting the doc', () => {
    // A NaN prop serializes to null over JSON — before this, one bad prop
    // failed EVERY save of the design with an opaque 400.
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].clips[0].keyframes = [
      { tMs: 0, props: { opacity: null, x: 10 } },
      { tMs: 500, props: { opacity: 1 } },
    ];
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(doc));
    const keyframes = parsed.outputs[0].tracks[0].clips[0].keyframes!;
    expect(keyframes[0].props).toEqual({ x: 10 });
    expect(keyframes[1].props).toEqual({ opacity: 1 });
  });

  it('parses a valid image doc strictly', () => {
    const parsed = DesignerDocStrictSchema.parse(migrateDoc(imageDocFixture));
    expect(parsed.mode).toBe('image');
  });

  it('accepts justify as a text align value', () => {
    const doc = JSON.parse(JSON.stringify(imageDocFixture));
    doc.outputs[0].children[0].align = 'justify';
    const result = DesignerDocStrictSchema.safeParse(migrateDoc(doc));
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys in strict mode', () => {
    const migrated = migrateDoc(imageDocFixture);
    const bad = { ...migrated, extraField: true };
    const result = DesignerDocStrictSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe('unrecognized_keys');
      expect(
        (result.error.issues[0] as any).keys
      ).toContain('extraField');
    }
  });

  it('rejects unknown keys on nested objects in strict mode', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[0].extra = 1;
    const result = DesignerDocStrictSchema.safeParse(migrateDoc(bad));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe('unrecognized_keys');
      expect(
        (result.error.issues[0] as any).path
      ).toEqual(['outputs', 0, 'children', 0]);
      expect(
        (result.error.issues[0] as any).keys
      ).toContain('extra');
    }
  });

  it('migrates a missing mode then passes', () => {
    const raw = { version: 2, outputs: imageDocFixture.outputs };
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(raw));
    expect(parsed.mode).toBe('image');
  });

  it('rejects opacity > 1 in strict mode', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[0].opacity = 1.5;
    const result = DesignerDocStrictSchema.safeParse(migrateDoc(bad));
    expect(result.success).toBe(false);
  });

  it('rejects durationMs > MAX_VIDEO_DURATION_MS in strict mode', () => {
    const bad = JSON.parse(JSON.stringify(videoDocFixture));
    bad.outputs[0].durationMs = MAX_VIDEO_DURATION_MS + 1;
    const result = DesignerDocStrictSchema.safeParse(migrateDoc(bad));
    expect(result.success).toBe(false);
  });

  it('accepts optional track name/muted in strict mode, and tolerates their absence', () => {
    const withFields = JSON.parse(JSON.stringify(videoDocFixture));
    withFields.outputs[0].tracks[0].name = 'B-roll';
    withFields.outputs[0].tracks[0].muted = true;
    const parsed = DesignerDocStrictSchema.parse(migrateDoc(withFields));
    expect(parsed.outputs[0].tracks[0].name).toBe('B-roll');
    expect(parsed.outputs[0].tracks[0].muted).toBe(true);

    // Absence is fine too (pre-existing docs carry neither field).
    const absent = DesignerDocStrictSchema.safeParse(migrateDoc(videoDocFixture));
    expect(absent.success).toBe(true);
  });

  it('accepts optional track locked/hidden in both parsers, and tolerates their absence', () => {
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].locked = true;
    doc.outputs[0].tracks[0].hidden = true;
    const strict = DesignerDocStrictSchema.parse(migrateDoc(doc));
    expect(strict.outputs[0].tracks[0].locked).toBe(true);
    expect(strict.outputs[0].tracks[0].hidden).toBe(true);
    const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(lenient.outputs[0].tracks[0].locked).toBe(true);
    expect(lenient.outputs[0].tracks[0].hidden).toBe(true);

    expect(DesignerDocStrictSchema.safeParse(migrateDoc(videoDocFixture)).success).toBe(true);
    expect(DesignerDocLenientSchema.safeParse(migrateDoc(videoDocFixture)).success).toBe(true);
  });

  it('round-trips the new transition types (wipe/zoom/blur) through BOTH parsers', () => {
    for (const type of ['wipe', 'zoom', 'blur']) {
      const doc = JSON.parse(JSON.stringify(videoDocFixture));
      doc.outputs[0].tracks[0].clips[0].transitionOut = { type, durationMs: 500, direction: 'left' };
      const strict = DesignerDocStrictSchema.parse(migrateDoc(doc));
      expect(strict.outputs[0].tracks[0].clips[0].transitionOut?.type).toBe(type);
      const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
      expect(lenient.outputs[0].tracks[0].clips[0].transitionOut?.type).toBe(type);
    }
  });

  it('still rejects an unknown transition type in strict mode', () => {
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].clips[0].transitionIn = { type: 'spin', durationMs: 500 };
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(doc)).success).toBe(false);
  });

  it('round-trips output markers through BOTH parsers, and tolerates their absence', () => {
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].markers = [
      { id: 'mk-1', tMs: 1500, name: 'Hook' },
      { id: 'mk-2', tMs: 4000 },
    ];
    const strict = DesignerDocStrictSchema.parse(migrateDoc(doc));
    expect(strict.outputs[0].markers).toEqual([
      { id: 'mk-1', tMs: 1500, name: 'Hook' },
      { id: 'mk-2', tMs: 4000 },
    ]);
    const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(lenient.outputs[0].markers).toHaveLength(2);

    expect(DesignerDocStrictSchema.safeParse(migrateDoc(videoDocFixture)).success).toBe(true);
  });

  it('round-trips a clip blendMode through migrateDoc and BOTH parsers', () => {
    // v7 additive field: docs saved before it existed carry nothing and keep
    // validating (covered by the fixture parse above); docs carrying it must
    // keep the value through load normalisation.
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].clips[0].blendMode = 'overlay';
    const strict = DesignerDocStrictSchema.parse(migrateDoc(doc));
    expect(strict.outputs[0].tracks[0].clips[0].blendMode).toBe('overlay');
    const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(lenient.outputs[0].tracks[0].clips[0].blendMode).toBe('overlay');
  });

  it('accepts every native blend mode on a clip, in both parsers', () => {
    for (const mode of CLIP_BLEND_MODES) {
      const doc = JSON.parse(JSON.stringify(videoDocFixture));
      doc.outputs[0].tracks[0].clips[0].blendMode = mode;
      expect(DesignerDocStrictSchema.safeParse(migrateDoc(doc)).success).toBe(true);
      expect(DesignerDocLenientSchema.safeParse(migrateDoc(doc)).success).toBe(true);
    }
  });

  it('rejects pixel-ops-only and unknown blend modes on a clip', () => {
    // A clip has no per-layer backdrop pipeline on either renderer, so the
    // pixel-evaluated modes (dissolve, vivid-light, …) must not validate here.
    for (const mode of ['dissolve', 'vivid-light', 'teleport']) {
      const doc = JSON.parse(JSON.stringify(videoDocFixture));
      doc.outputs[0].tracks[0].clips[0].blendMode = mode;
      expect(DesignerDocStrictSchema.safeParse(migrateDoc(doc)).success).toBe(false);
      expect(DesignerDocLenientSchema.safeParse(migrateDoc(doc)).success).toBe(false);
    }
  });

  it('round-trips a clip speedCurve through migrateDoc and BOTH parsers (v7)', () => {
    // Optional-additive, like blendMode: docs saved before ramps existed carry
    // nothing and keep validating (the fixture above); docs carrying a curve
    // must keep the points through load normalisation.
    const curve = [
      { atMs: 0, speed: 1 },
      { atMs: 1000, speed: 3 },
    ];
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].clips[0].speedCurve = curve;
    const strict = DesignerDocStrictSchema.parse(migrateDoc(doc));
    expect(strict.outputs[0].tracks[0].clips[0].speedCurve).toEqual(curve);
    const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(lenient.outputs[0].tracks[0].clips[0].speedCurve).toEqual(curve);
  });

  it('rejects an out-of-range speedCurve point strictly, clamps it leniently', () => {
    const doc = JSON.parse(JSON.stringify(videoDocFixture));
    doc.outputs[0].tracks[0].clips[0].speedCurve = [
      { atMs: 0, speed: 40 },
      { atMs: 1000, speed: 0.01 },
    ];
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(doc)).success).toBe(false);
    const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(lenient.outputs[0].tracks[0].clips[0].speedCurve).toEqual([
      { atMs: 0, speed: 10 },
      { atMs: 1000, speed: 0.1 },
    ]);
  });

  it('round-trips a background texture through both parsers (v7)', () => {
    const doc = JSON.parse(JSON.stringify(imageDocFixture));
    doc.outputs[0].bg.texture = { type: 'grain', intensity: 0.4, scale: 2, seed: 1234 };
    const strict = DesignerDocStrictSchema.parse(migrateDoc(doc));
    expect(strict.outputs[0].bg?.texture).toEqual({
      type: 'grain',
      intensity: 0.4,
      scale: 2,
      seed: 1234,
    });
    const lenient = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(lenient.outputs[0].bg?.texture).toEqual({
      type: 'grain',
      intensity: 0.4,
      scale: 2,
      seed: 1234,
    });
  });

  it('rejects an unknown texture type in strict mode', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].bg.texture = { type: 'denim' };
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(bad)).success).toBe(false);
  });

  it('clamps an out-of-range texture intensity in lenient mode', () => {
    const doc = JSON.parse(JSON.stringify(imageDocFixture));
    doc.outputs[0].bg.texture = { type: 'paper', intensity: 4 };
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(doc));
    expect(parsed.outputs[0].bg?.texture?.intensity).toBe(1);
  });

  it('parses a texture-less background exactly as before', () => {
    const parsed = DesignerDocStrictSchema.parse(migrateDoc(imageDocFixture));
    expect(parsed.outputs[0].bg?.texture).toBeUndefined();
  });

  it('rejects a non-data/http(s) src', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[1].src = 'file:///etc/passwd';
    const result = DesignerDocStrictSchema.safeParse(migrateDoc(bad));
    expect(result.success).toBe(false);
  });

  it('rejects too many children', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children = Array(MAX_ELEMENTS_PER_OUTPUT + 1).fill(
      imageDocFixture.outputs[0].children[0]
    );
    const result = DesignerDocLenientSchema.safeParse(migrateDoc(bad));
    expect(result.success).toBe(false);
  });

  it('rejects an invalid filter string', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[1].filters = ['invalid-token'];
    const result = DesignerDocStrictSchema.safeParse(migrateDoc(bad));
    expect(result.success).toBe(false);
  });

  it('clamps opacity > 1 in lenient mode and logs', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[0].opacity = 1.5;
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(bad));
    expect(parsed.outputs[0].children[0].opacity).toBe(1);
    consoleSpy.mockRestore();
  });

  it('clamps an oversized logical dimension in lenient mode', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].width = MAX_DIMENSION + 100;
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(bad));
    expect(parsed.outputs[0].width).toBe(MAX_DIMENSION);
  });

  it('defaults missing locked/hidden to false in lenient mode', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    delete bad.outputs[0].children[0].locked;
    bad.outputs[0].children[1].hidden = 'nope' as any;
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(bad));
    expect(parsed.outputs[0].children[0].locked).toBe(false);
    expect(parsed.outputs[0].children[1].hidden).toBe(false);
  });

  it('does not stamp text defaults onto non-text elements in lenient mode', () => {
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(imageDocFixture));
    const image = parsed.outputs[0].children[1];
    expect(image.fontSize).toBeUndefined();
    expect(image.fontWeight).toBeUndefined();
    expect(image.lineHeight).toBeUndefined();
    expect(image.strokeWidth).toBeUndefined();
    // A present-but-invalid value is dropped, not defaulted.
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[1].fontSize = 'huge';
    const reparsed = DesignerDocLenientSchema.parse(migrateDoc(bad));
    expect(reparsed.outputs[0].children[1].fontSize).toBeUndefined();
    // Text keeps what it declared, clamped.
    const clamped = JSON.parse(JSON.stringify(imageDocFixture));
    clamped.outputs[0].children[0].fontSize = 1e9;
    const textParsed = DesignerDocLenientSchema.parse(migrateDoc(clamped));
    expect(textParsed.outputs[0].children[0].fontSize).toBe(MAX_FONT_SIZE);
  });

  it('stamps no fontSize onto rich-text RUNS that never carried one', () => {
    // The renderer resolves `run.fontSize ?? el.fontSize`, so a lenient-stamped
    // 16 on a run silently shrank the line: an emphasised 96px headline
    // rendered at 16px (live, sale run).
    const doc = JSON.parse(JSON.stringify(imageDocFixture));
    doc.outputs[0].children[0].richText = [
      { text: 'BUY 1 GET 1 ' },
      { text: 'FREE', fill: '#00F0FF', fontWeight: 900 },
    ];
    const parsed = DesignerDocLenientSchema.parse(migrateDoc(doc));
    const runs = parsed.outputs[0].children[0].richText!;
    expect(runs[0].fontSize).toBeUndefined();
    expect(runs[1].fontSize).toBeUndefined();
    expect(runs[1].fontWeight).toBe(900);
  });

  it('accepts a managed http src in dev', () => {
    const ok = JSON.parse(JSON.stringify(imageDocFixture));
    ok.outputs[0].children[1].src = 'http://localhost:3000/uploads/asset.png';
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(ok)).success).toBe(true);
  });

  it('accepts raw SVG markup as an icon src, strictly and leniently', () => {
    const doc = JSON.parse(JSON.stringify(imageDocFixture));
    doc.outputs[0].children.push({
      id: 'el-icon',
      type: 'icon',
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: '<path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77z"/>',
      fill: '#2B5CD3',
    });
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(doc)).success).toBe(true);
    expect(DesignerDocLenientSchema.safeParse(migrateDoc(doc)).success).toBe(true);
  });

  it('rejects raw SVG markup as a non-icon src', () => {
    const bad = JSON.parse(JSON.stringify(imageDocFixture));
    bad.outputs[0].children[1].src = '<path d="M0 0h1v1z"/>';
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(bad)).success).toBe(false);
    expect(DesignerDocLenientSchema.safeParse(migrateDoc(bad)).success).toBe(false);
  });
});

describe('primitive schemas', () => {
  it('rejects a color longer than 64 chars', () => {
    expect(ColorSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('rejects a src longer than 2048 chars', () => {
    expect(SrcSchema.safeParse('https://x/' + 'a'.repeat(2048)).success).toBe(false);
  });

  it('accepts an inline (data:/SVG-markup) src past the URL cap', () => {
    expect(
      SrcSchema.safeParse('data:image/svg+xml;base64,' + 'a'.repeat(10_000)).success
    ).toBe(true);
    expect(SrcSchema.safeParse('<path d="' + 'M0 0h1v1z'.repeat(1000) + '"/>').success).toBe(
      true
    );
  });

  it('rejects an inline src beyond the inline cap', () => {
    expect(
      SrcSchema.safeParse('data:image/png;base64,' + 'a'.repeat(MAX_INLINE_SRC_LEN)).success
    ).toBe(false);
  });

  it('rejects a non-filter token', () => {
    expect(DesignerFilterStringSchema.safeParse('foo').success).toBe(false);
  });

  it('accepts a valid filter token', () => {
    expect(DesignerFilterStringSchema.safeParse('brightness:1.2').success).toBe(true);
  });
});
