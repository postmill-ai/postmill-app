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

// Real Chrome + FFmpeg acceptance is deliberately GitHub-runner-only. The
// designer-video-acceptance workflow installs both binaries and sets the opt-in.
describe.skipIf(process.env.GITHUB_ACTIONS !== 'true' || process.env.RUN_RENDER_INTEGRATION !== '1')('Chromium + ffmpeg video render integration', () => {
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

  it('exports gradient and outlined text over an animated video clip to MP4', async () => {
    const fs = await import('fs');
    const http = await import('http');
    const { execFileSync } = await import('child_process');
    const fixture = fs.readFileSync(path.resolve(__dirname, '../../../../../e2e/fixtures/motion-animated.mp4'));
    const server = http.createServer((request, response) => {
      response.setHeader('accept-ranges', 'bytes');
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('content-type', 'video/mp4');
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(match[2] ? Number(match[2]) : fixture.length - 1, fixture.length - 1);
        response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${fixture.length}` });
        response.end(fixture.subarray(start, end + 1));
      } else {
        response.end(fixture);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
    const src = `http://127.0.0.1:${address.port}/motion.mp4`;
    const capture = new ChromiumFrameCaptureService();
    const encoder = new FfmpegVideoEncoderService(capture);
    let result: Awaited<ReturnType<typeof encoder.encode>> | undefined;

    try {
      const output: VideoOutput = {
        ...redVideo(1000),
        background: '#000000',
        tracks: [
          {
            id: 'motion', type: 'video',
            clips: [{
              id: 'animated-sticker', src, mediaType: 'video', startMs: 0, endMs: 1000,
              x: 0, y: 70, width: 320, height: 170, naturalWidth: 720, naturalHeight: 1280,
              fitMode: 'fill', volume: 0,
            }],
          },
          {
            id: 'panel', type: 'shape',
            clips: [{
              id: 'panel', shape: 'rect', fill: '#ffffff', startMs: 0, endMs: 1000,
              x: 0, y: 0, width: 320, height: 70,
            }],
          },
          {
            id: 'text', type: 'text',
            clips: [{
              id: 'gradient-outline', text: 'GRADIENT', startMs: 0, endMs: 1000,
              x: 10, y: 10, width: 200, height: 45,
              fontFamily: 'Arial', fontSize: 32, fontWeight: 700,
              textStroke: { color: '#000000', width: 3 },
              fillGradient: {
                type: 'linear', angle: 0,
                stops: [
                  { offset: 0, color: '#ff0000' },
                  { offset: 0.5, color: '#ffff00' },
                  { offset: 1, color: '#0000ff' },
                ],
              },
            }],
          },
        ],
      };
      result = await encoder.encode(output, { fps: 5, bitrateKbps: 500, format: 'mp4' });
      expect(fs.statSync(result.videoPath).size).toBeGreaterThan(1000);
      const metadata = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height:format=duration',
        '-of', 'json', result.videoPath,
      ], { encoding: 'utf8' }));
      expect(metadata.streams[0]).toMatchObject({ codec_name: 'h264', width: 320, height: 240 });
      expect(Number(metadata.format.duration)).toBeCloseTo(1, 1);

      const { data, info } = await sharp(result.thumbnailPath)
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const colors = { red: 0, yellow: 0, blue: 0, outline: 0 };
      for (let y = 0; y < 70; y++) {
        for (let x = 0; x < info.width; x++) {
          const index = (y * info.width + x) * info.channels;
          const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
          if (r > 150 && g < 120 && b < 120) colors.red++;
          if (r > 150 && g > 150 && b < 120) colors.yellow++;
          if (b > 120 && r < 150 && g < 170) colors.blue++;
          if (r < 60 && g < 60 && b < 60) colors.outline++;
        }
      }
      expect(colors.red).toBeGreaterThan(5);
      expect(colors.yellow).toBeGreaterThan(5);
      expect(colors.blue).toBeGreaterThan(5);
      expect(colors.outline).toBeGreaterThan(20);

      const firstPath = path.join(path.dirname(result.videoPath), 'first.png');
      const lastPath = path.join(path.dirname(result.videoPath), 'last.png');
      execFileSync('ffmpeg', ['-y', '-ss', '0', '-i', result.videoPath, '-frames:v', '1', firstPath], { stdio: 'ignore' });
      execFileSync('ffmpeg', ['-y', '-sseof', '-0.2', '-i', result.videoPath, '-frames:v', '1', lastPath], { stdio: 'ignore' });
      const crop = { left: 0, top: 80, width: 320, height: 160 };
      const first = await sharp(firstPath).extract(crop).raw().toBuffer();
      const last = await sharp(lastPath).extract(crop).raw().toBuffer();
      expect(first.equals(last)).toBe(false);
    } finally {
      if (result) encoder.cleanup(path.dirname(result.videoPath));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120000);
});
