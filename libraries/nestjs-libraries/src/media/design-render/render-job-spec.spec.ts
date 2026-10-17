import { describe, it, expect } from 'vitest';
import { renderOutputName } from './render-job-spec';
import { formatExtension } from './ffmpeg-video-encoder.service';

describe('renderOutputName', () => {
  it('matches the encoder output filename for every render format', () => {
    // The worker writes <out>/renderOutputName(format) and the host reads the
    // same name — a mismatch surfaces as ENOENT after a successful encode
    // (seen live: webp-animated template previews).
    for (const format of ['mp4', 'webm', 'gif', 'webp-animated']) {
      expect(renderOutputName(format)).toBe(`output.${formatExtension(format)}`);
    }
  });

  it('webp-animated maps to output.webp (ffmpeg infers the muxer from the extension)', () => {
    expect(renderOutputName('webp-animated')).toBe('output.webp');
  });
});
