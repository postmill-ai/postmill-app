import { describe, expect, it, vi } from 'vitest';
import { fetchDesignForEditor } from './load-design';

const response = (ok: boolean, body: unknown) => ({ ok, json: vi.fn().mockResolvedValue(body) }) as unknown as Response;

describe('fetchDesignForEditor', () => {
  it('loads the deep-linked design record', async () => {
    const fetch = vi.fn().mockResolvedValue(response(true, {
      id: 'design-123', name: 'Catalog', doc: { mode: 'image', outputs: [] },
    }));

    await expect(fetchDesignForEditor(fetch, 'design-123')).resolves.toEqual({
      id: 'design-123', name: 'Catalog', doc: { mode: 'image', outputs: [] }, batch: null,
    });
    expect(fetch).toHaveBeenCalledWith('/media/designs/design-123');
  });

  it('preserves the variation batch for Back to batch after a deep-linked reload', async () => {
    const fetch = vi.fn().mockResolvedValue(response(true, {
      id: 'variation-1', name: 'Variation 1', doc: { mode: 'image', outputs: [] },
      batch: { id: 'batch-1', name: 'Catalog' },
    }));

    await expect(fetchDesignForEditor(fetch, 'variation-1')).resolves.toMatchObject({
      batch: { id: 'batch-1', name: 'Catalog' },
    });
  });

  it('rejects missing designs and error-shaped success responses', async () => {
    await expect(fetchDesignForEditor(
      vi.fn().mockResolvedValue(response(false, { message: 'Not found' })),
      'missing',
    )).resolves.toBeNull();
    await expect(fetchDesignForEditor(
      vi.fn().mockResolvedValue(response(true, { message: 'Not found' })),
      'missing',
    )).resolves.toBeNull();
  });
});
