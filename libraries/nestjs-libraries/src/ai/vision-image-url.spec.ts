import { describe, expect, it, vi } from 'vitest';
import { resolveVisionImageUrl } from './vision-image-url';

/**
 * The AI Designer's contact sheet rides memory as a `data:` URI instead of
 * being persisted to storage on every save — the resolver must pass it
 * through (it is already inline, so there is nothing to fetch or read)
 * subject only to the prompt-size cap.
 */
describe('resolveVisionImageUrl data URIs', () => {
  it('passes an image data URI through unchanged', async () => {
    const uri = `data:image/png;base64,${Buffer.from('sheet').toString('base64')}`;
    await expect(resolveVisionImageUrl(uri)).resolves.toBe(uri);
  });

  it('refuses an inlined image over the byte cap', async () => {
    const warn = vi.fn();
    const uri = `data:image/png;base64,${Buffer.alloc(1024).toString('base64')}`;
    await expect(
      resolveVisionImageUrl(uri, { warn, maxInlineBytes: 512 })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('still rejects a non-image data URI', async () => {
    await expect(
      resolveVisionImageUrl('data:text/html;base64,PGI+')
    ).resolves.toBeNull();
  });
});
