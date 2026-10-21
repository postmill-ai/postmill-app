import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake the ffmpeg child process: the probe prints a Duration line on stderr and
// exits 1 (ffmpeg -i with no output always does); the fade run "writes" its
// output file and closes 0. Real fs/tmpdirs are used — only spawn is stubbed.
const h = vi.hoisted(() => ({
  state: {
    mode: 'ok' as 'ok' | 'probe-fail' | 'fade-fail' | 'spawn-error',
    calls: [] as string[][],
  },
}));

vi.mock('child_process', async () => {
  const fs = await import('fs');
  return {
    spawn: (_bin: string, args: string[]) => {
      h.state.calls.push(args);
      const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
      const stderrHandlers: ((d: unknown) => void)[] = [];
      const proc = {
        stderr: {
          on: (_ev: string, cb: (d: unknown) => void) => {
            stderrHandlers.push(cb);
          },
        },
        on: (ev: string, cb: (...a: unknown[]) => void) => {
          (handlers[ev] ||= []).push(cb);
          return proc;
        },
      };
      queueMicrotask(() => {
        const emitErr = (s: string) => stderrHandlers.forEach((cb) => cb(Buffer.from(s)));
        const close = (code: number) => handlers['close']?.forEach((cb) => cb(code));
        if (h.state.mode === 'spawn-error') {
          handlers['error']?.forEach((cb) => cb(new Error('spawn ffmpeg ENOENT')));
          return;
        }
        if (!args.includes('-af')) {
          // The duration probe.
          if (h.state.mode !== 'probe-fail') {
            emitErr('Input #0, mp3, from \'in.mp3\':\n  Duration: 00:00:05.00, start: 0.000000, bitrate: 128 kb/s');
          }
          close(1);
          return;
        }
        if (h.state.mode === 'fade-fail') {
          emitErr('Error opening output file');
          close(1);
          return;
        }
        fs.writeFileSync(args[args.length - 1], Buffer.from('faded-audio'));
        close(0);
      });
      return proc;
    },
  };
});

import { applyAudioOutroFade, parseFfmpegDurationSeconds } from './audio-outro-fade';

describe('parseFfmpegDurationSeconds', () => {
  it('parses the Duration line from ffmpeg -i stderr', () => {
    expect(parseFfmpegDurationSeconds('  Duration: 00:00:05.00, start: 0.0')).toBe(5);
    expect(parseFfmpegDurationSeconds('  Duration: 01:02:03.50,')).toBe(3723.5);
  });

  it('returns null when no parseable duration is present', () => {
    expect(parseFfmpegDurationSeconds('')).toBeNull();
    expect(parseFfmpegDurationSeconds('Duration: N/A')).toBeNull();
    expect(parseFfmpegDurationSeconds('Duration: 00:00:00.00')).toBeNull();
  });
});

describe('applyAudioOutroFade', () => {
  beforeEach(() => {
    h.state.mode = 'ok';
    h.state.calls = [];
  });

  it('probes the duration, then runs a duration-anchored afade=t=out', async () => {
    const out = await applyAudioOutroFade(Buffer.from('orig-bytes'), 'audio/mpeg');

    expect(out.toString()).toBe('faded-audio');
    expect(h.state.calls).toHaveLength(2);
    // Probe: header-only read of the downloaded bytes.
    expect(h.state.calls[0][0]).toBe('-hide_banner');
    expect(h.state.calls[0][1]).toBe('-i');
    // Fade: 400ms outro ending at the 5s track end → st=4.600, d=0.400.
    const fadeArgs = h.state.calls[1];
    expect(fadeArgs).toContain('-af');
    expect(fadeArgs[fadeArgs.indexOf('-af') + 1]).toBe('afade=t=out:st=4.600:d=0.400');
  });

  it('uses the provider metadata duration instead of probing when known', async () => {
    const out = await applyAudioOutroFade(Buffer.from('orig-bytes'), 'audio/mpeg', 30);

    expect(out.toString()).toBe('faded-audio');
    expect(h.state.calls).toHaveLength(1); // no probe
    const fadeArgs = h.state.calls[0];
    expect(fadeArgs[fadeArgs.indexOf('-af') + 1]).toBe('afade=t=out:st=29.600:d=0.400');
  });

  it('caps the fade at half the track for a very short clip', async () => {
    await applyAudioOutroFade(Buffer.from('x'), 'audio/mpeg', 0.5);
    const fadeArgs = h.state.calls[0];
    expect(fadeArgs[fadeArgs.indexOf('-af') + 1]).toBe('afade=t=out:st=0.250:d=0.250');
  });

  it('returns the original bytes when the fade run fails', async () => {
    h.state.mode = 'fade-fail';
    const out = await applyAudioOutroFade(Buffer.from('orig-bytes'), 'audio/mpeg', 5);
    expect(out.toString()).toBe('orig-bytes');
  });

  it('returns the original bytes when the duration cannot be probed', async () => {
    h.state.mode = 'probe-fail';
    const out = await applyAudioOutroFade(Buffer.from('orig-bytes'), 'audio/mpeg');
    expect(out.toString()).toBe('orig-bytes');
    expect(h.state.calls).toHaveLength(1); // no fade attempted
  });

  it('returns the original bytes when ffmpeg cannot be spawned at all', async () => {
    h.state.mode = 'spawn-error';
    const out = await applyAudioOutroFade(Buffer.from('orig-bytes'), 'audio/mpeg');
    expect(out.toString()).toBe('orig-bytes');
  });

  it('skips containers it will not transcode (stored verbatim, no ffmpeg run)', async () => {
    const out = await applyAudioOutroFade(Buffer.from('orig-bytes'), 'audio/ogg');
    expect(out.toString()).toBe('orig-bytes');
    expect(h.state.calls).toHaveLength(0);
  });
});
