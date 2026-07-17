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
});
