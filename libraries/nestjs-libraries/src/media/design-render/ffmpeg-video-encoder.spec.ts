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
});
