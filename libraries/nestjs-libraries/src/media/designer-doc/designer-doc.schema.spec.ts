import { describe, it, expect, vi } from 'vitest';
import {
  DesignerDocLenientSchema,
  DesignerDocStrictSchema,
  ColorSchema,
  SrcSchema,
  DesignerFilterStringSchema,
} from './designer-doc.schema';
import { migrateDoc } from './designer-doc.migrate';
import {
  MAX_DIMENSION,
  MAX_ELEMENTS_PER_OUTPUT,
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

  it('parses a valid image doc strictly', () => {
    const parsed = DesignerDocStrictSchema.parse(migrateDoc(imageDocFixture));
    expect(parsed.mode).toBe('image');
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

  it('accepts a managed http src in dev', () => {
    const ok = JSON.parse(JSON.stringify(imageDocFixture));
    ok.outputs[0].children[1].src = 'http://localhost:3000/uploads/asset.png';
    expect(DesignerDocStrictSchema.safeParse(migrateDoc(ok)).success).toBe(true);
  });
});

describe('primitive schemas', () => {
  it('rejects a color longer than 64 chars', () => {
    expect(ColorSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('rejects a src longer than 2048 chars', () => {
    expect(SrcSchema.safeParse('https://x/' + 'a'.repeat(2048)).success).toBe(false);
  });

  it('rejects a non-filter token', () => {
    expect(DesignerFilterStringSchema.safeParse('foo').success).toBe(false);
  });

  it('accepts a valid filter token', () => {
    expect(DesignerFilterStringSchema.safeParse('brightness:1.2').success).toBe(true);
  });
});
