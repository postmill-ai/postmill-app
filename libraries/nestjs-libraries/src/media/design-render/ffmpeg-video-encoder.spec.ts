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

describe('FfmpegVideoEncoderService.mixAudio loudness and hidden tracks', () => {
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

  const mixGraph = async (out: any, normalizeLoudness = false): Promise<string | null> => {
    const service = new FfmpegVideoEncoderService();
    vi.spyOn(service as any, 'getAudioDurationMs').mockResolvedValue(60000);
    vi.spyOn(service as any, 'downloadAudio').mockResolvedValue('/tmp/fake.mp4');
    const mixed = await service.mixAudio(out, '/tmp', normalizeLoudness);
    if (!mixed) return null;
    // Last matching call: a test may mix twice with different options.
    const mixCall = [...spawnCalls].reverse().find((c) => c.args.includes('-filter_complex'));
    expect(mixCall).toBeTruthy();
    return mixCall!.args[mixCall!.args.indexOf('-filter_complex') + 1];
  };

  it('appends loudnorm after the final mix only when normalizeLoudness is on', async () => {
    const withNorm = await mixGraph(output, true);
    expect(withNorm).toContain('loudnorm=I=-14:TP=-1.5');
    // It must sit on the FINAL mix chain (the [outa] leg), not on a stem.
    expect(withNorm).toContain('loudnorm=I=-14:TP=-1.5[outa]');

    const without = await mixGraph(output, false);
    expect(without).not.toContain('loudnorm');
  });

  it('encode() forwards the normalizeLoudness option to mixAudio', async () => {
    const frameCapture = { captureFrames: vi.fn().mockResolvedValue(10) };
    const service = new FfmpegVideoEncoderService(frameCapture as any);
    const mix = vi.spyOn(service as any, 'mixAudio').mockResolvedValue('/tmp/mixed-audio.wav');
    await service.encode(output, { fps: 30, format: 'mp4', normalizeLoudness: true });
    expect(mix).toHaveBeenCalledWith(output, expect.any(String), true);
  });

  it('a hidden track contributes nothing to the mix (like a muted one)', async () => {
    const hiddenOut = {
      ...output,
      tracks: [{ ...output.tracks[0], hidden: true }],
    };
    const service = new FfmpegVideoEncoderService();
    vi.spyOn(service as any, 'getAudioDurationMs').mockResolvedValue(60000);
    const download = vi.spyOn(service as any, 'downloadAudio').mockResolvedValue('/tmp/fake.mp4');
    const mixed = await service.mixAudio(hiddenOut, '/tmp');
    expect(mixed).toBeNull();
    // Not even downloaded — a hidden track is excluded everywhere.
    expect(download).not.toHaveBeenCalled();
  });

  it('returns null (no audio at all) when every clip source is silent', async () => {
    const service = new FfmpegVideoEncoderService();
    vi.spyOn(service as any, 'getAudioDurationMs').mockResolvedValue(60000);
    vi.spyOn(service as any, 'downloadAudio').mockResolvedValue('/tmp/fake.mp4');
    vi.spyOn(service as any, 'hasAudioStream').mockResolvedValue(false);
    const mixed = await service.mixAudio(output, '/tmp');
    expect(mixed).toBeNull();
  });

  it('skips a no-audio-stream source instead of aborting the whole mix', async () => {
    // Regression: a video clip with volume > 0 but no audio stream in its
    // source made ffmpeg abort with "Stream specifier ':a' ... matches no
    // streams", failing the render after all frames were already captured.
    const twoClips = {
      ...output,
      tracks: [
        {
          type: 'video',
          gain: 1,
          clips: [
            {
              id: 'silent',
              startMs: 0,
              endMs: 6000,
              src: 'https://example.com/uploads/silent.mp4',
            },
            {
              id: 'audible',
              startMs: 0,
              endMs: 8000,
              src: 'https://example.com/uploads/audible.mp4',
            },
          ],
        },
      ],
    };
    const service = new FfmpegVideoEncoderService();
    vi.spyOn(service as any, 'getAudioDurationMs').mockResolvedValue(60000);
    const download = vi
      .spyOn(service as any, 'downloadAudio')
      .mockResolvedValueOnce('/tmp/silent.mp4')
      .mockResolvedValueOnce('/tmp/audible.mp4');
    vi.spyOn(service as any, 'hasAudioStream').mockImplementation(
      async (p: string) => p.includes('audible'),
    );

    const mixed = await service.mixAudio(twoClips, '/tmp');
    expect(mixed).toBeTruthy();
    expect(download).toHaveBeenCalledTimes(2);

    const mixCall = [...spawnCalls].reverse().find((c) => c.args.includes('-filter_complex'));
    expect(mixCall).toBeTruthy();
    // Only the audible file is an input, so it is stream [0:a] in the graph.
    const graph = mixCall!.args[mixCall!.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[0:a]');
    const fileInputs = mixCall!.args.filter((a, i) => a === '-i' && mixCall!.args[i + 1]?.includes('.mp4'));
    expect(fileInputs).toHaveLength(1);
    expect(mixCall!.args).toContain('/tmp/audible.mp4');
    expect(mixCall!.args).not.toContain('/tmp/silent.mp4');
  });
});
