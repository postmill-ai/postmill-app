import { describe, expect, it, vi } from 'vitest';
import {
  aiDesignerStartSafetyTimeoutMs,
  uploadAiDesignerAttachments,
} from './ai-designer-attachments';

const uploadResponse = (id: string) => new Response(JSON.stringify({ id, path: `/uploads/${id}.png` }), {
  headers: { 'Content-Type': 'application/json' },
});

describe('uploadAiDesignerAttachments', () => {
  it('splits image references from document attachments', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(uploadResponse('image-1'))
      .mockResolvedValueOnce(uploadResponse('doc-1'));
    const files = [
      new File(['image'], 'mockup.png', { type: 'image/png' }),
      new File(['brief'], 'brief.txt', { type: 'text/plain' }),
    ];

    const result = await uploadAiDesignerAttachments(fetchFn as any, files);

    expect(result.references.map((item) => item.fileId)).toEqual(['image-1']);
    expect(result.documents).toEqual([{ fileId: 'doc-1', name: 'brief.txt' }]);
    expect(fetchFn.mock.calls.map(([path]) => path)).toEqual([
      '/files/upload-simple',
      '/files/upload-simple',
    ]);
  });

  it('rejects unsupported types and files over 20 MB before upload', async () => {
    const fetchFn = vi.fn();
    await expect(uploadAiDesignerAttachments(fetchFn as any, [
      new File(['x'], 'archive.zip', { type: 'application/zip' }),
    ])).rejects.toThrow('must be an image, PDF, TXT, Markdown, CSV, TSV, or JSON file');

    const large = new File(['x'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(large, 'size', { value: 20 * 1024 * 1024 + 1 });
    await expect(uploadAiDesignerAttachments(fetchFn as any, [large])).rejects.toThrow(
      'exceeds the 20 MB attachment limit'
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces the server error for a failed upload', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'quota exceeded' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(uploadAiDesignerAttachments(fetchFn as any, [
      new File(['brief'], 'brief.txt', { type: 'text/plain' }),
    ])).rejects.toThrow('quota exceeded');
  });
});

describe('aiDesignerStartSafetyTimeoutMs', () => {
  it('allows slower pre-session validation only when attachments are present', () => {
    expect(aiDesignerStartSafetyTimeoutMs({})).toBe(10_000);
    expect(aiDesignerStartSafetyTimeoutMs({ referenceFileIds: ['image-1'] })).toBe(60_000);
    expect(aiDesignerStartSafetyTimeoutMs({ attachmentFileIds: ['doc-1'] })).toBe(60_000);
  });
});
