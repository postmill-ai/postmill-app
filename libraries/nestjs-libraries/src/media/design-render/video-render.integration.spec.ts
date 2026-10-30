import { describe, it, expect } from 'vitest';
import path from 'path';
import sharp from 'sharp';
import { ChromiumFrameCaptureService } from './chromium-frame-capture.service';
import { FfmpegVideoEncoderService } from './ffmpeg-video-encoder.service';
import type { VideoOutput } from './design-render.types';

const redVideo = (durationMs = 1000): VideoOutput => ({
  id: 'test-output',
  formatId: 'test',
  name: 'Test',
  width: 320,
  height: 240,
  fps: 5,
  durationMs,
  tracks: [],
  background: '#ff0000',
});

// 2x2 red PNG as a data: URI — passes the SSRF guard without any network.
const RED_PX_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQI12P8z8AARQwMDAxMDEAMAwAHWwID9/HxpwAAAABJRU5ErkJggg==';

/**
 * Mirrors the production composition that wedged parallel capture (#172
 * follow-up): gradient bg + image clip + two text clips joined by a fade
 * transition, NO video clips. On headless Chromium only the front-most page is
 * `visible`, and a compositor screenshot of a hidden page pends forever — so
 * page 0's first frame always timed out while page 1's stride completed. Frames
 * now leave the page via canvas.toDataURL readback, which is
 * visibility-independent; this test fails on the old screenshot path.
 */
const parallelComposition = (): any => ({
  id: 'parallel-capture',
  formatId: 'story',
  name: 'Parallel capture',
  width: 540,
  height: 960,
  fps: 30,
  durationMs: 6000,
  background: '#000000',
  bg: {
    type: 'gradient',
    gradient: {
      angle: 45,
      stops: [
        { offset: 0, color: '#112233' },
        { offset: 1, color: '#dd4466' },
      ],
    },
  },
  tracks: [
    {
      id: 'img-track',
      type: 'image',
      clips: [
        { id: 'img-1', type: 'image', src: RED_PX_DATA_URL, startMs: 0, endMs: 6000, x: 50, y: 200, width: 440, height: 440 },
      ],
    },
    {
      id: 'text-track',
      type: 'text',
      clips: [
        {
          id: 'txt-a', text: 'First half', startMs: 0, endMs: 3000,
          x: 30, y: 750, width: 480, height: 100, fontSize: 32, fontFamily: 'Arial', fill: '#ffffff',
          transitionOut: { type: 'fade', durationMs: 500 },
        },
        {
          id: 'txt-b', text: 'Second half', startMs: 3000, endMs: 6000,
          x: 30, y: 750, width: 480, height: 100, fontSize: 32, fontFamily: 'Arial', fill: '#ffffff',
          transitionIn: { type: 'fade', durationMs: 500 },
        },
      ],
    },
  ],
});

// Opt-in: this spec launches a real headless Chrome + FFmpeg, which CI runners
// don't provide. Run locally with RUN_RENDER_INTEGRATION=1.
describe.skipIf(process.env.RUN_RENDER_INTEGRATION !== '1')('Chromium + ffmpeg video render integration', () => {
  it('renders a 1-second red MP4 with a thumbnail', async () => {
    const capture = new ChromiumFrameCaptureService();
    const encoder = new FfmpegVideoEncoderService(capture);

    const result = await encoder.encode(redVideo(), {
      fps: 5,
      bitrateKbps: 500,
      format: 'mp4',
    });

    const fs = await import('fs');
    expect(fs.existsSync(result.videoPath)).toBe(true);
    expect(fs.existsSync(result.thumbnailPath)).toBe(true);
    expect(fs.statSync(result.videoPath).size).toBeGreaterThan(1000);
    expect(fs.statSync(result.thumbnailPath).size).toBeGreaterThan(100);

    encoder.cleanup(path.dirname(result.videoPath));
  }, 120000);

  it('extracts the selected timeline frame instead of the midpoint', async () => {
    const capture = new ChromiumFrameCaptureService();
    const encoder = new FfmpegVideoEncoderService(capture);
    const output: VideoOutput = {
      ...redVideo(4000),
      background: '#ffffff',
      tracks: [{
        id: 'poster-colors',
        type: 'shape',
        clips: [
          {
            id: 'red-opening', type: 'shape', shape: 'rect', fill: '#ff0000',
            startMs: 0, endMs: 2000, x: 0, y: 0, width: 320, height: 240,
          },
          {
            id: 'blue-ending', type: 'shape', shape: 'rect', fill: '#0000ff',
            startMs: 2000, endMs: 4000, x: 0, y: 0, width: 320, height: 240,
          },
        ],
      }],
    };

    const result = await encoder.encode(output, {
      fps: 5,
      bitrateKbps: 500,
      format: 'mp4',
      posterTimeMs: 1000,
    });

    const { data, info } = await sharp(result.thumbnailPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const index = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[index]).toBeGreaterThan(180);
    expect(data[index + 1]).toBeLessThan(80);
    expect(data[index + 2]).toBeLessThan(80);

    encoder.cleanup(path.dirname(result.videoPath));
  }, 120000);

  it('renders an odd scaled raster as an even-dimension MP4', async () => {
    const capture = new ChromiumFrameCaptureService();
    const encoder = new FfmpegVideoEncoderService(capture);

    const result = await encoder.encode(
      { ...redVideo(), width: 1080, height: 1920 },
      { fps: 5, scale: 0.56, bitrateKbps: 500, format: 'mp4' },
    );

    const fs = await import('fs');
    const { execFileSync } = await import('child_process');
    const metadata = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      result.videoPath,
    ], { encoding: 'utf8' }));
    expect(metadata.streams[0]).toMatchObject({ width: 604, height: 1074 });
    expect(fs.statSync(result.videoPath).size).toBeGreaterThan(1000);

    encoder.cleanup(path.dirname(result.videoPath));
  }, 120000);

  it('renders a 1-second red animated GIF with a thumbnail', async () => {
    const capture = new ChromiumFrameCaptureService();
    const encoder = new FfmpegVideoEncoderService(capture);

    const result = await encoder.encode(redVideo(), {
      fps: 5,
      bitrateKbps: 500,
      format: 'gif',
    });

    const fs = await import('fs');
    expect(fs.existsSync(result.videoPath)).toBe(true);
    expect(result.videoPath.endsWith('.gif')).toBe(true);
    expect(fs.existsSync(result.thumbnailPath)).toBe(true);
    expect(fs.statSync(result.videoPath).size).toBeGreaterThan(1000);

    encoder.cleanup(path.dirname(result.videoPath));
  }, 120000);

  it('captures every frame on 2 parallel pages (hidden-page screenshot wedge regression)', async () => {
    process.env.VIDEO_RENDER_CAPTURE_PAGES = '2';
    try {
      const capture = new ChromiumFrameCaptureService();
      const fs = await import('fs');
      const os = await import('os');
      const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-capture-'));
      try {
        // 6s @ 30fps = 180 frames > PARALLEL_CAPTURE_MIN_FRAMES → 2 pages.
        const frames = await capture.captureFrames(parallelComposition(), 30, frameDir);
        expect(frames).toBe(180);
        const files = fs.readdirSync(frameDir).sort();
        expect(files).toEqual(
          Array.from({ length: 180 }, (_, f) => `frame-${String(f + 1).padStart(5, '0')}.png`),
        );
        // Frames from BOTH strides are valid non-trivial PNGs (frame 1 is page
        // 0's first frame — the one that wedged on the screenshot path).
        for (const name of ['frame-00001.png', 'frame-00002.png', 'frame-00180.png']) {
          const png = fs.readFileSync(path.join(frameDir, name));
          expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
          expect(png.length).toBeGreaterThan(1000);
          expect(png.readUInt32BE(16)).toBe(540);
          expect(png.readUInt32BE(20)).toBe(960);
        }
      } finally {
        fs.rmSync(frameDir, { recursive: true, force: true });
      }
    } finally {
      delete process.env.VIDEO_RENDER_CAPTURE_PAGES;
    }
  }, 120000);

  it('captures cover, contain, fill, and explicit-crop frame pixels', async () => {
    const raw = Buffer.alloc(8 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 8; x++) {
        const index = (y * 8 + x) * 4;
        const color = x < 4
          ? (y === 0 ? [255, 0, 0] : [0, 255, 0])
          : (y === 0 ? [0, 0, 255] : [255, 255, 0]);
        raw[index] = color[0];
        raw[index + 1] = color[1];
        raw[index + 2] = color[2];
        raw[index + 3] = 255;
      }
    }
    const png = await sharp(raw, { raw: { width: 8, height: 2, channels: 4 } }).png().toBuffer();
    const src = `data:image/png;base64,${png.toString('base64')}`;
    const baseClip = {
      type: 'image' as const, src, startMs: 0, endMs: 1000,
      x: 0, y: 0, width: 200, height: 200,
      naturalWidth: 8, naturalHeight: 2,
    };
    const cases = [
      {
        id: 'default-cover', clip: { focalPoint: { x: 0.75, y: 0.5 } },
        checks: [
          [100, 40, [0, 0, 255, 255]],
          [100, 160, [255, 255, 0, 255]],
        ],
      },
      {
        id: 'contain', clip: { fitMode: 'contain' as const },
        checks: [
          [100, 25, [255, 255, 255, 255]],
          [25, 90, [255, 0, 0, 255]],
          [175, 90, [0, 0, 255, 255]],
        ],
      },
      {
        id: 'fill', clip: { fitMode: 'fill' as const },
        checks: [
          [25, 40, [255, 0, 0, 255]],
          [175, 40, [0, 0, 255, 255]],
          [25, 160, [0, 255, 0, 255]],
          [175, 160, [255, 255, 0, 255]],
        ],
      },
      {
        id: 'crop', clip: { crop: { x: 4, y: 0, width: 4, height: 2 } },
        checks: [
          [100, 25, [255, 255, 255, 255]],
          [100, 75, [0, 0, 255, 255]],
          [100, 125, [255, 255, 0, 255]],
        ],
      },
    ];

    const capture = new ChromiumFrameCaptureService();
    const fs = await import('fs');
    const os = await import('os');
    const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-fit-capture-'));
    const expectColor = async (dir: string, x: number, y: number, expected: number[]) => {
      const { data, info } = await sharp(path.join(dir, 'frame-00001.png'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const index = (y * info.width + x) * info.channels;
      const actual = [data[index], data[index + 1], data[index + 2], data[index + 3]];
      for (let channel = 0; channel < 4; channel++) {
        expect(
          Math.abs(actual[channel] - expected[channel]),
          `${dir} pixel ${x},${y} channel ${channel}: actual ${actual}, expected ${expected}`
        ).toBeLessThanOrEqual(25);
      }
    };

    try {
      for (const testCase of cases) {
        const dir = path.join(frameDir, testCase.id);
        fs.mkdirSync(dir);
        const output: VideoOutput = {
          ...redVideo(1000),
          width: 200,
          height: 200,
          fps: 1,
          background: '#ffffff',
          tracks: [{
            id: 'fit-track', type: 'image',
            clips: [{ ...baseClip, id: testCase.id, ...testCase.clip }],
          }],
        };
        expect(await capture.captureFrames(output, 1, dir)).toBe(1);
        for (const [x, y, expected] of testCase.checks) {
          await expectColor(dir, x, y, expected);
        }
      }
    } finally {
      fs.rmSync(frameDir, { recursive: true, force: true });
    }
  }, 120000);

  it('captures per-corner radii and real italic glyph pixels', async () => {
    const capture = new ChromiumFrameCaptureService();
    const fs = await import('fs');
    const os = await import('os');
    const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radius-italic-capture-'));
    const output = (fontStyle: 'normal' | 'italic'): VideoOutput => ({
      ...redVideo(1000),
      width: 200,
      height: 200,
      fps: 1,
      background: '#ffffff',
      tracks: [
        {
          id: 'shape', type: 'shape',
          clips: [{
            id: 'rounded', shape: 'rect', startMs: 0, endMs: 1000,
            x: 0, y: 0, width: 200, height: 100,
            fill: '#ff0000', borderRadius: [60, 0, 0, 0],
          }],
        },
        {
          id: 'text', type: 'text',
          clips: [{
            id: 'italic', text: 'Italic', startMs: 0, endMs: 1000,
            x: 10, y: 115, width: 180, height: 60,
            fontFamily: 'Arial', fontSize: 40, fontWeight: 400,
            fontStyle, fill: '#000000',
          }],
        },
      ],
    });
    const pixel = async (dir: string, x: number, y: number) => {
      const { data, info } = await sharp(path.join(dir, 'frame-00001.png'))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const index = (y * info.width + x) * info.channels;
      return [...data.subarray(index, index + 4)];
    };
    try {
      const normalDir = path.join(frameDir, 'normal');
      const italicDir = path.join(frameDir, 'italic');
      fs.mkdirSync(normalDir);
      fs.mkdirSync(italicDir);
      expect(await capture.captureFrames(output('normal'), 1, normalDir)).toBe(1);
      expect(await capture.captureFrames(output('italic'), 1, italicDir)).toBe(1);

      expect((await pixel(normalDir, 4, 4))[0]).toBeGreaterThan(240);
      expect((await pixel(normalDir, 196, 4))[0]).toBeGreaterThan(240);
      expect((await pixel(normalDir, 4, 96))[0]).toBeGreaterThan(240);

      const normal = await sharp(path.join(normalDir, 'frame-00001.png')).raw().toBuffer();
      const italic = await sharp(path.join(italicDir, 'frame-00001.png')).raw().toBuffer();
      expect(italic.equals(normal)).toBe(false);
      const darkPixels = italic.reduce((count, _value, index) =>
        index % 3 === 0 && italic[index] < 100 ? count + 1 : count, 0);
      expect(darkPixels).toBeGreaterThan(100);
    } finally {
      fs.rmSync(frameDir, { recursive: true, force: true });
    }
  }, 120000);
});
