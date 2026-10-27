import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encodeImageSequenceToMp4 } from './image-sequence-encoder';

function findFfmpeg(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require('ffmpeg-static') as string | undefined;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  const which = spawnSync('which', ['ffmpeg']);
  return which.status === 0 ? which.stdout.toString().trim().split('\n')[0] : null;
}

const FFMPEG = findFfmpeg();
const HAS_FFPROBE = spawnSync('which', ['ffprobe']).status === 0;
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAcElEQVR4nO3PAQkAAAyEwO/febAYIggXQHebGl/QgBxf0IAcX9CAHF/QgBxf0IAcX9CAHF/QgBxf0IAcX9CAHF/QgBxf0IAcX9CAHF/QgBxf0IAcX9CAHF/QgBxf0IAcX9CAHF/QgBxf0IAcX9CA3ANcoNDiu2vTdwAAAABJRU5ErkJggg==';

describe.skipIf(!FFMPEG)('encodeImageSequenceToMp4 — real ffmpeg', () => {
  it('produces a probeable H264/yuv420p MP4 with silent AAC, exact duration, canvas, and faststart', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-sequence-spec-'));
    try {
      const first = path.join(tmpDir, 'first.png');
      const second = path.join(tmpDir, 'second.png');
      const output = path.join(tmpDir, 'output.mp4');
      fs.writeFileSync(first, Buffer.from(PNG_BASE64, 'base64'));
      fs.writeFileSync(second, Buffer.from(PNG_BASE64, 'base64'));

      await encodeImageSequenceToMp4([
        { imagePath: first, durationSeconds: 0.5 },
        { imagePath: second, durationSeconds: 0.75 },
      ], output, { targetWidth: 320, targetHeight: 180, fitMode: 'contain' });

      const buffer = fs.readFileSync(output);
      expect(buffer.subarray(4, 8).toString('ascii')).toBe('ftyp');
      expect(buffer.indexOf(Buffer.from('moov'))).toBeLessThan(buffer.indexOf(Buffer.from('mdat')));

      if (HAS_FFPROBE) {
        const probe = JSON.parse(execFileSync('ffprobe', [
          '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', output,
        ]).toString());
        const video = probe.streams.find((stream: any) => stream.codec_type === 'video');
        const audio = probe.streams.find((stream: any) => stream.codec_type === 'audio');
        expect(video).toEqual(expect.objectContaining({
          codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180,
        }));
        expect(audio.codec_name).toBe('aac');
        expect(Number(probe.format.duration)).toBeGreaterThan(1.1);
        expect(Number(probe.format.duration)).toBeLessThan(1.5);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects malformed image bytes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-sequence-spec-'));
    try {
      const input = path.join(tmpDir, 'broken.jpg');
      const output = path.join(tmpDir, 'output.mp4');
      fs.writeFileSync(input, Buffer.from('not an image'));

      await expect(encodeImageSequenceToMp4([
        { imagePath: input, durationSeconds: 1 },
      ], output)).rejects.toThrow('ffmpeg exited');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
