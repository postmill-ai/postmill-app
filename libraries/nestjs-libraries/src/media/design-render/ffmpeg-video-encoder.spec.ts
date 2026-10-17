import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Capture the filter_complex graph handed to ffmpeg and fake a successful run.
const spawnCalls: { args: string[] }[] = [];
vi.mock('child_process', () => ({
  spawn: (bin: string, args: string[]) => {
    spawnCalls.push({ args });
    const proc = new EventEmitter() as any;
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit('close', 0));
    return proc;
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: vi.fn(async () => ({
    ok: true,
    body: null,
    arrayBuffer: async () => new ArrayBuffer(8),
  })),
}));

import { FfmpegVideoEncoderService } from './ffmpeg-video-encoder.service';

describe('FfmpegVideoEncoderService.mixAudio filter graph', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  const output: any = {
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs: 12685,
    tracks: [
      {
        type: 'video',
        gain: 1,
        clips: [
          {
            id: 'clip-1',
            startMs: 0,
            endMs: 12685,
            src: 'https://example.com/uploads/clip.mp4',
          },
        ],
      },
    ],
  };

  it('never emits an empty filter (no comma before output pad labels)', async () => {
    const service = new FfmpegVideoEncoderService();
    // Skip the probe: mixAudio only needs a numeric duration back.
    vi.spyOn(service as any, 'getAudioDurationMs').mockResolvedValue(12685);
    // Skip the actual download write.
    vi.spyOn(service as any, 'downloadAudio').mockResolvedValue('/tmp/fake.mp4');

    await service.mixAudio(output, '/tmp');

    const mixCall = spawnCalls.find((c) => c.args.includes('-filter_complex'));
    expect(mixCall).toBeTruthy();
    const graph = mixCall!.args[mixCall!.args.indexOf('-filter_complex') + 1];
    // Regression: `filter,[label]` parses as an empty filter -> ffmpeg aborts
    // with "No such filter: ''". Output pad labels terminate the chain with
    // no separator.
    expect(graph).not.toMatch(',\s*\[');
    expect(graph).toContain('[p0]');
    expect(graph).toContain('[outa]');
  });

  it('encode() places the audio input before any output options', async () => {
    const frameCapture = { captureFrames: vi.fn().mockResolvedValue(381) };
    const service = new FfmpegVideoEncoderService(frameCapture as any);
    vi.spyOn(service as any, 'mixAudio').mockResolvedValue('/tmp/mixed-audio.wav');

    await service.encode(output, { fps: 30, format: 'mp4' });

    // Find the final mux call: the one whose inputs are the frame pattern.
    const muxCall = spawnCalls.find((c) =>
      c.args.some((a) => a.includes('frame-%05d')),
    );
    expect(muxCall).toBeTruthy();
    const args = muxCall!.args;
    const audioInputIdx = args.indexOf('/tmp/mixed-audio.wav');
    expect(audioInputIdx).toBeGreaterThan(-1);
    expect(args[audioInputIdx - 1]).toBe('-i');
    // Regression: output options before the audio `-i` are parsed as INPUT
    // options for the wav -> "Error parsing options for input file".
    const cvIdx = args.indexOf('-c:v');
    expect(cvIdx).toBeGreaterThan(audioInputIdx);
    const caIdx = args.indexOf('-c:a');
    expect(caIdx).toBeGreaterThan(audioInputIdx);
  });

  const mixGraph = async (out: any): Promise<string> => {
    const service = new FfmpegVideoEncoderService();
    vi.spyOn(service as any, 'getAudioDurationMs').mockResolvedValue(60000);
    vi.spyOn(service as any, 'downloadAudio').mockResolvedValue('/tmp/fake.mp4');
    await service.mixAudio(out, '/tmp');
    const mixCall = spawnCalls.find((c) => c.args.includes('-filter_complex'));
    expect(mixCall).toBeTruthy();
    return mixCall!.args[mixCall!.args.indexOf('-filter_complex') + 1];
  };

  it('emits a per-frame volume expression when a clip has volume keyframes', async () => {
    const graph = await mixGraph({
      ...output,
      tracks: [
        {
          type: 'audio',
          gain: 0.5,
          clips: [
            {
              id: 'm1',
              startMs: 0,
              endMs: 4000,
              src: 'https://example.com/m.mp3',
              volume: 1,
              keyframes: [
                { tMs: 0, props: { volume: 0 } },
                { tMs: 4000, props: { volume: 1 } },
              ],
            },
          ],
        },
      ],
    });

    // The constant filter must be gone; the quoted expression carries track
    // gain baked in (endpoint 1 × 0.5) and evaluates per frame.
    expect(graph).toContain(":eval=frame");
    expect(graph).toMatch(/volume='[^']*':eval=frame/);
    expect(graph).not.toMatch(/volume=0\.5[,:]/);
    // Linear ramp 0 → 0.5 over 4s: slope 0.125, first segment min(t,0.1).
    expect(graph).toContain('+0.125*(min(t,0.1)-min(t,0))');
  });

  it('keeps the constant volume filter when no volume keyframes exist', async () => {
    const graph = await mixGraph({
      ...output,
      tracks: [
        {
          type: 'audio',
          gain: 0.5,
          clips: [
            {
              id: 'm1',
              startMs: 0,
              endMs: 4000,
              src: 'https://example.com/m.mp3',
              volume: 1,
              keyframes: [{ tMs: 0, props: { x: 10 } }],
            },
          ],
        },
      ],
    });
    expect(graph).toContain('volume=0.5000');
    expect(graph).not.toContain('eval=frame');
  });

  it('mixes a video clip whose base volume is 0 but whose keyframes raise it', async () => {
    const graph = await mixGraph({
      ...output,
      tracks: [
        {
          type: 'video',
          gain: 1,
          clips: [
            {
              id: 'v1',
              startMs: 0,
              endMs: 2000,
              src: 'https://example.com/v.mp4',
              volume: 0,
              keyframes: [
                { tMs: 0, props: { volume: 0 } },
                { tMs: 2000, props: { volume: 0.8 } },
              ],
            },
          ],
        },
      ],
    });
    expect(graph).toContain('[p0]');
    expect(graph).toContain(':eval=frame');
  });

  it('emits the constant filter for keyframes that sample flat', async () => {
    const graph = await mixGraph({
      ...output,
      tracks: [
        {
          type: 'audio',
          gain: 1,
          clips: [
            {
              id: 'm1',
              startMs: 0,
              endMs: 2000,
              src: 'https://example.com/m.mp3',
              keyframes: [
                { tMs: 0, props: { volume: 0.3 } },
                { tMs: 2000, props: { volume: 0.3 } },
              ],
            },
          ],
        },
      ],
    });
    expect(graph).toContain('volume=0.3000');
    expect(graph).not.toContain('eval=frame');
  });
});

describe('formatExtension', () => {
  it('maps webp-animated to webp (ffmpeg infers the muxer from the extension)', async () => {
    const { formatExtension } = await import('./ffmpeg-video-encoder.service');
    expect(formatExtension('webp-animated')).toBe('webp');
    expect(formatExtension('mp4')).toBe('mp4');
    expect(formatExtension('webm')).toBe('webm');
    expect(formatExtension('gif')).toBe('gif');
  });

  it('encode() writes output.webp for webp-animated (regression: output.webp-animated fails ffmpeg with Invalid argument)', async () => {
    const frameCapture = { captureFrames: vi.fn().mockResolvedValue(36) };
    const service = new FfmpegVideoEncoderService(frameCapture as any);
    vi.spyOn(service as any, 'mixAudio').mockResolvedValue(null);
    const out: any = {
      width: 540, height: 540, fps: 12, durationMs: 3000,
      tracks: [{ type: 'video', gain: 1, clips: [] }],
    };
    await service.encode(out, { fps: 12, format: 'webp-animated' });
    const muxCall = spawnCalls.find((c) =>
      c.args.some((a) => a.includes('frame-%05d')),
    );
    expect(muxCall).toBeTruthy();
    const outPath = muxCall!.args[muxCall!.args.length - 1];
    expect(outPath).toMatch(/output\.webp$/);
  });
});
