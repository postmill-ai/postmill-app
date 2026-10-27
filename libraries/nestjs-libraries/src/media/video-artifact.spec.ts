import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

import {
  prepareVideoArtifact,
  presentMediaMetadata,
  remuxVideoToFaststart,
} from './video-artifact';

const probeJson = JSON.stringify({
  streams: [{ codec_type: 'video', width: 1920, height: 1080, duration: '5.25' }],
  format: { duration: '5.25' },
});

function succeedWithRemux() {
  mockExecFile.mockImplementation((...args: any[]) => {
    const [command, commandArgs] = args;
    const callback = args[args.length - 1];
    if (command === 'ffmpeg') {
      fs.writeFileSync(commandArgs[commandArgs.length - 1], 'remuxed');
    }
    callback(null, command === 'ffprobe' ? probeJson : '', '');
  });
}

describe('video artifact preparation', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    succeedWithRemux();
  });

  it.each([
    ['video/mp4', '.mp4'],
    ['video/x-m4v', '.m4v'],
    ['video/quicktime', '.mov'],
  ])('probes and stream-copy remuxes %s with faststart', async (mime, ext) => {
    const original = Buffer.from('original');

    const result = await prepareVideoArtifact(original, mime);

    expect(result.buffer).toEqual(Buffer.from('remuxed'));
    expect(result.metadata).toEqual({
      dimensions: { width: 1920, height: 1080 },
      durationMs: 5250,
    });
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const [probeCommand, probeArgs, probeOptions] = mockExecFile.mock.calls[0];
    expect(probeCommand).toBe('ffprobe');
    expect(probeArgs).toContain('stream=codec_type,width,height,duration:format=duration');
    expect(probeArgs[probeArgs.length - 1].endsWith(ext)).toBe(true);
    expect(probeOptions).toMatchObject({ timeout: 15_000 });
    const [ffmpegCommand, ffmpegArgs, ffmpegOptions] = mockExecFile.mock.calls[1];
    expect(ffmpegCommand).toBe('ffmpeg');
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart']),
    );
    expect(ffmpegArgs).not.toContain('libx264');
    expect(ffmpegOptions).toMatchObject({ timeout: 60_000 });
    expect(fs.existsSync(probeArgs[probeArgs.length - 1])).toBe(false);
  });

  it('keeps the original bytes but retains valid probe metadata when remux fails', async () => {
    const original = Buffer.from('original');
    mockExecFile.mockImplementation((...args: any[]) => {
      const [command] = args;
      const callback = args[args.length - 1];
      callback(
        command === 'ffmpeg' ? new Error('ffmpeg unavailable') : null,
        command === 'ffprobe' ? probeJson : '',
        '',
      );
    });

    const result = await prepareVideoArtifact(original, 'video/mp4');

    expect(result.buffer).toBe(original);
    expect(result.metadata).toEqual({
      dimensions: { width: 1920, height: 1080 },
      durationMs: 5250,
    });
  });

  it('keeps the original bytes and does not remux when probing fails', async () => {
    const original = Buffer.from('original');
    mockExecFile.mockImplementation((...args: any[]) => {
      args[args.length - 1](new Error('ffprobe unavailable'), '', '');
    });

    const result = await prepareVideoArtifact(original, 'video/mp4');

    expect(result).toEqual({ buffer: original });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile.mock.calls[0][0]).toBe('ffprobe');
  });

  it('rejects incomplete probe output instead of exposing misleading metadata', async () => {
    const original = Buffer.from('original');
    mockExecFile.mockImplementation((...args: any[]) => {
      args[args.length - 1](null, JSON.stringify({ streams: [], format: {} }), '');
    });

    const result = await prepareVideoArtifact(original, 'video/mp4');

    expect(result).toEqual({ buffer: original });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('probes WebM metadata without applying MP4 faststart remuxing', async () => {
    const original = Buffer.from('original');

    const result = await prepareVideoArtifact(original, 'video/webm');

    expect(result).toEqual({
      buffer: original,
      metadata: {
        dimensions: { width: 1920, height: 1080 },
        durationMs: 5250,
      },
    });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile.mock.calls[0][0]).toBe('ffprobe');
  });

  it.each(['image/jpeg', 'audio/mpeg'])(
    'does not probe or transcode %s',
    async (mime) => {
      const original = Buffer.from('original');

      await expect(prepareVideoArtifact(original, mime)).resolves.toEqual({
        buffer: original,
      });
      expect(mockExecFile).not.toHaveBeenCalled();
    },
  );

  it('cleans a failed remux temp without replacing the original file', async () => {
    const workDir = fs.mkdtempSync('/tmp/postmill-remux-spec-');
    const filePath = `${workDir}/clip.mp4`;
    fs.writeFileSync(filePath, 'original');
    mockExecFile.mockImplementation((...args: any[]) => {
      args[args.length - 1](new Error('failed'), '', '');
    });

    await expect(remuxVideoToFaststart(filePath)).resolves.toBe(false);

    expect(fs.readFileSync(filePath, 'utf8')).toBe('original');
    expect(fs.readdirSync(workDir)).toEqual(['clip.mp4']);
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});

describe('presentMediaMetadata', () => {
  it('returns only canonical playback fields', () => {
    expect(presentMediaMetadata({
      dimensions: { width: 1280, height: 720 },
      durationMs: 5234,
      mime: 'video/mp4',
      provider: 'secret-provider-detail',
      prompt: 'private prompt',
      provenance: 'internal provenance',
    })).toEqual({
      dimensions: { width: 1280, height: 720 },
      durationMs: 5234,
      mime: 'video/mp4',
    });
  });

  it.each([null, undefined, 'video', [], {}, { prompt: 'private' }])(
    'returns null when no safe canonical fields exist in %j',
    (value) => {
      expect(presentMediaMetadata(value)).toBeNull();
    },
  );

  it('drops malformed numeric and MIME fields independently', () => {
    expect(presentMediaMetadata({
      dimensions: { width: -1, height: 720 },
      durationMs: Number.NaN,
      mime: 'not a mime',
    })).toBeNull();
    expect(presentMediaMetadata({ durationMs: 1000 })).toEqual({ durationMs: 1000 });
  });
});
