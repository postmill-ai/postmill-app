import { describe, it, expect } from 'vitest';
import path from 'path';
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
});
