import { describe, expect, it, vi } from 'vitest';
import { fetchDesignForEditor } from './load-design';

const response = (ok: boolean, body: unknown) => ({ ok, json: vi.fn().mockResolvedValue(body) }) as unknown as Response;

describe('fetchDesignForEditor', () => {
  it('loads the deep-linked design record', async () => {
    const fetch = vi.fn().mockResolvedValue(response(true, {
      id: 'design-123', name: 'Catalog', doc: { mode: 'image', outputs: [] },
    }));

    await expect(fetchDesignForEditor(fetch, 'design-123')).resolves.toEqual({
      id: 'design-123', name: 'Catalog', doc: { mode: 'image', outputs: [] },
    });
    expect(fetch).toHaveBeenCalledWith('/media/designs/design-123');
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
