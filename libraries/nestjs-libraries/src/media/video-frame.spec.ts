import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.fn();
const mockMkdtempSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock('fs', () => ({
  mkdtempSync: (...args: any[]) => mockMkdtempSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  existsSync: (...args: any[]) => mockExistsSync(...args),
  statSync: (...args: any[]) => mockStatSync(...args),
  rmSync: (...args: any[]) => mockRmSync(...args),
}));

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import {
  extractVideoFrame,
  extractVideoFrameInfo,
  VIDEO_FRAME_MAX_BYTES,
} from './video-frame';

const fakeJpeg = Buffer.from('fake-jpeg-bytes');

function makeFfmpegProcess(exitCode: number, stderrText = '') {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    stderr: {
      on: vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data' && stderrText) {
          setTimeout(() => cb(Buffer.from(stderrText)), 0);
        }
      }),
    },
    on: vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 1);
      }
    }),
  };
}

/** Queue the processes spawn hands out, in call order. */
function queueProcesses(...procs: Array<ReturnType<typeof makeFfmpegProcess>>) {
  let i = 0;
  mockSpawn.mockImplementation(() => procs[Math.min(i++, procs.length - 1)]);
}

describe('extractVideoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtempSync.mockReturnValue('/tmp/postmill-vframe-test');
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: fakeJpeg.length });
    mockReadFileSync.mockReturnValue(fakeJpeg);
  });

  it('seeks to 0.1s for a normal-duration video and returns the JPEG frame', async () => {
    queueProcesses(
      makeFfmpegProcess(1, 'Duration: 00:00:10.00, start: 0.000000'),
      makeFfmpegProcess(0)
    );

    const out = await extractVideoFrame(Buffer.from('mp4-bytes'), 'mp4');

    expect(out).toEqual(fakeJpeg);
    // Probe, then the frame grab.
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const probeArgs = mockSpawn.mock.calls[0][1];
    expect(probeArgs).toEqual(['-hide_banner', '-i', '/tmp/postmill-vframe-test/in.mp4']);
    const grabArgs = mockSpawn.mock.calls[1][1];
    expect(grabArgs).toContain('-ss');
    expect(grabArgs[grabArgs.indexOf('-ss') + 1]).toBe('0.100');
    expect(grabArgs).toContain('-frames:v');
    expect(grabArgs).toContain('1');
    // The temp dir is always cleaned up.
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/postmill-vframe-test', {
      recursive: true,
      force: true,
    });
  });

  it('falls back to frame 0 for a degenerate file (no parseable duration)', async () => {
    queueProcesses(makeFfmpegProcess(1, 'garbage header'), makeFfmpegProcess(0));

    const out = await extractVideoFrame(Buffer.from('mp4-bytes'), 'mp4');

    expect(out).toEqual(fakeJpeg);
    const grabArgs = mockSpawn.mock.calls[1][1];
    expect(grabArgs[grabArgs.indexOf('-ss') + 1]).toBe('0.000');
  });

  it('falls back to frame 0 for a clip shorter than the seek', async () => {
    queueProcesses(
      makeFfmpegProcess(1, 'Duration: 00:00:00.05, start: 0.000000'),
      makeFfmpegProcess(0)
    );

    await extractVideoFrame(Buffer.from('mp4-bytes'), 'mp4');

    const grabArgs = mockSpawn.mock.calls[1][1];
    expect(grabArgs[grabArgs.indexOf('-ss') + 1]).toBe('0.000');
  });

  it('retries at frame 0 when the seek yields no output', async () => {
    queueProcesses(
      makeFfmpegProcess(1, 'Duration: 00:00:10.00, start: 0.000000'),
      makeFfmpegProcess(0),
      makeFfmpegProcess(0)
    );
    // Path-aware: the ffmpeg binary resolution also probes existsSync, so key
    // the flakiness on the frame output — first grab missing, retry present.
    let frameChecks = 0;
    mockExistsSync.mockImplementation((p: string) => {
      if (String(p).endsWith('frame.jpg')) {
        frameChecks++;
        return frameChecks > 1;
      }
      return true;
    });

    const out = await extractVideoFrame(Buffer.from('mp4-bytes'), 'mp4');

    expect(out).toEqual(fakeJpeg);
    expect(mockSpawn).toHaveBeenCalledTimes(3);
    const retryArgs = mockSpawn.mock.calls[2][1];
    expect(retryArgs[retryArgs.indexOf('-ss') + 1]).toBe('0.000');
  });

  it('returns null when ffmpeg cannot decode the file', async () => {
    queueProcesses(
      makeFfmpegProcess(1, 'Duration: 00:00:10.00, start: 0.000000'),
      makeFfmpegProcess(1, 'moov atom not found'),
      makeFfmpegProcess(1, 'moov atom not found')
    );
    mockExistsSync.mockReturnValue(false);

    const out = await extractVideoFrame(Buffer.from('mp4-bytes'), 'mp4');

    expect(out).toBeNull();
    expect(mockRmSync).toHaveBeenCalled();
  });

  it('returns null without spawning for empty or oversized buffers', async () => {
    expect(await extractVideoFrame(Buffer.alloc(0), 'mp4')).toBeNull();
    expect(
      await extractVideoFrame(Buffer.alloc(VIDEO_FRAME_MAX_BYTES + 1), 'mp4')
    ).toBeNull();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('reports audio-only media from the probe without attempting a frame decode', async () => {
    queueProcesses(makeFfmpegProcess(1, [
      'Duration: 00:00:03.00, start: 0.000000',
      'Stream #0:0: Audio: opus, 48000 Hz, stereo, fltp',
    ].join('\n')));

    const out = await extractVideoFrameInfo(Buffer.from('webm-bytes'), 'webm');

    expect(out).toEqual({ frame: null, hasVideoStream: false, hasAudioStream: true });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockRmSync).toHaveBeenCalled();
  });

  it('reports video and audio streams while returning an ordinary video frame', async () => {
    queueProcesses(
      makeFfmpegProcess(1, [
        'Duration: 00:00:10.00, start: 0.000000',
        'Stream #0:0: Video: h264 (High), yuv420p, 1920x1080',
        'Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo',
      ].join('\n')),
      makeFfmpegProcess(0),
    );

    const out = await extractVideoFrameInfo(Buffer.from('mp4-bytes'), 'mp4');

    expect(out).toEqual({ frame: fakeJpeg, hasVideoStream: true, hasAudioStream: true });
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('preserves stream information when frame decoding fails', async () => {
    queueProcesses(
      makeFfmpegProcess(1, [
        'Duration: 00:00:10.00, start: 0.000000',
        'Stream #0:0: Video: h264 (High), yuv420p, 1920x1080',
      ].join('\n')),
      makeFfmpegProcess(1, 'decode failed'),
      makeFfmpegProcess(1, 'decode failed'),
    );
    mockExistsSync.mockReturnValue(false);

    const out = await extractVideoFrameInfo(Buffer.from('mp4-bytes'), 'mp4');

    expect(out).toEqual({ frame: null, hasVideoStream: true, hasAudioStream: false });
  });
});
