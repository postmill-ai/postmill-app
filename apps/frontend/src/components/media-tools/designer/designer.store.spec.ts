import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createDesignerStore, migrateDoc, type DesignerStore } from './designer.store';

/**
 * Simulates the designer export flow as implemented in Designer.tsx:
 * - renders the Konva canvas to a PNG blob
 * - uploads it via POST /files/upload-simple
 * - returns the file {id, path} contract expected by the composer.
 */
async function exportDesignFromStore(
  store: ReturnType<typeof createDesignerStore>,
  fetchMock: typeof fetch
): Promise<{ id: string; path: string } | null> {
  const state = store.getState();
  const canvas = document.querySelector(
    '.konva-stage canvas'
  ) as HTMLCanvasElement | null;

  if (!canvas) {
    return null;
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });

  if (!blob) {
    return null;
  }

  const name = state.designName.replace(/[^a-zA-Z0-9]/g, '_');
  const formData = new FormData();
  formData.append('file', blob, `${name}.png`);

  const res = await fetchMock('/files/upload-simple', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

describe('createDesignerStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes with an empty document and a clean history', () => {
    const store = createDesignerStore(1200, 628);
    const state = store.getState();

    expect(state.doc).toMatchObject({
      version: 2,
      mode: 'image',
      outputs: [
        expect.objectContaining({
          id: expect.any(String),
          background: '#ffffff',
          children: [],
          width: 1200,
          height: 628,
        }),
      ],
    });
    expect(state.history).toHaveLength(1);
    expect(state.historyIndex).toBe(0);
    expect(state.isDirty).toBe(false);
    expect(state.designName).toBe('Untitled Design');
  });

  it('tracks element additions in history and supports undo/redo', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());

    act(() => {
      result.current.addElement({
        id: '',
        type: 'text',
        x: 10,
        y: 20,
        width: 100,
        height: 30,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        text: 'Hello',
      });
    });

    const addedId = result.current.doc.outputs[0].children[0].id;
    expect(addedId).toBeTruthy();
    expect(result.current.doc.outputs[0].children).toHaveLength(1);
    expect(result.current.historyIndex).toBe(1);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.selectedIds).toEqual([addedId]);

    act(() => {
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(0);
    expect(result.current.historyIndex).toBe(0);
    expect(result.current.selectedIds).toEqual([]);

    act(() => {
      result.current.redo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(1);
    expect(result.current.doc.outputs[0].children[0].text).toBe('Hello');
    expect(result.current.historyIndex).toBe(1);
  });

  it('removes an element and can undo the change', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());

    act(() => {
      result.current.addElement({
        id: 'el-1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        text: 'Before',
      });
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(1);

    act(() => {
      result.current.removeElement('el-1');
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(0);

    act(() => {
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(1);
    expect(result.current.doc.outputs[0].children[0].text).toBe('Before');
  });

  it('caps history at 50 snapshots by dropping the oldest', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());

    for (let i = 0; i < 55; i++) {
      act(() => {
        result.current.addElement({
          id: `el-${i}`,
          type: 'shape',
          x: i,
          y: i,
          width: 10,
          height: 10,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          shape: 'rect',
        });
      });
    }

    expect(result.current.history).toHaveLength(50);

    // The oldest 6 snapshots (empty doc + el-0..el-4) have been dropped,
    // so the earliest remaining snapshot contains 6 elements (el-0..el-5).
    act(() => {
      for (let i = 0; i < 49; i++) {
        result.current.undo();
      }
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(6);

    // Further undos are no-ops because we are at the oldest retained snapshot.
    act(() => {
      result.current.undo();
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(6);
  });

  it('produces the {id,path} export contract after uploading the canvas blob', async () => {
    const store = createDesignerStore(800, 600);
    const { result } = renderHook(() => store());

    act(() => {
      result.current.setDesignName('Social Post');
    });

    const fakeBlob = new Blob(['png-bytes'], { type: 'image/png' });

    const canvas = document.createElement('canvas');
    canvas.className = 'konva-stage';
    // The selector looks for .konva-stage canvas, so create a nested canvas.
    const innerCanvas = document.createElement('canvas');
    innerCanvas.toBlob = vi.fn((cb: BlobCallback | null) => {
      if (cb) cb(fakeBlob);
    }) as any;
    canvas.appendChild(innerCanvas);
    document.body.appendChild(canvas);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'file-123', path: 'https://cdn.example.com/design.png' }),
    });

    const exported = await exportDesignFromStore(store, fetchMock as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/files/upload-simple',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    );

    const formData = fetchMock.mock.calls[0][1].body as FormData;
    expect(formData.get('file')).toBeInstanceOf(Blob);
    expect((formData.get('file') as File).name).toBe('Social_Post.png');

    expect(exported).toEqual({
      id: 'file-123',
      path: 'https://cdn.example.com/design.png',
    });

    document.body.removeChild(canvas);
  });

  it('returns null when the canvas is not present during export', async () => {
    const store = createDesignerStore();
    const fetchMock = vi.fn();

    const exported = await exportDesignFromStore(store, fetchMock as any);

    expect(exported).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('migrateDoc', () => {
  it('migrates a legacy page-based doc to the new outputs shape', () => {
    const legacy = {
      version: 1,
      width: 1080,
      height: 1080,
      pages: [
        {
          id: 'page-1',
          background: '#000000',
          children: [
            { id: 'el-1', type: 'text', x: 10, y: 20, width: 100, height: 30, rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Hello' },
          ],
        },
      ],
    };

    const doc = migrateDoc(legacy);

    expect(doc.mode).toBe('image');
    expect(doc.version).toBe(2);
    expect(doc.outputs).toHaveLength(1);
    expect(doc.outputs[0].width).toBe(1080);
    expect(doc.outputs[0].height).toBe(1080);
    expect(doc.outputs[0].background).toBe('#000000');
    expect(doc.outputs[0].children).toHaveLength(1);
    expect(doc.outputs[0].children[0].text).toBe('Hello');
    expect(doc.outputs[0].formatId).toBe('ig-post');
    expect(doc.outputs[0].name).toBeTruthy();
  });

  it('leaves a new outputs-based doc unchanged', () => {
    const newDoc = {
      version: 2,
      mode: 'image',
      outputs: [{ id: 'out-1', formatId: 'x-post', name: 'X Post', width: 1600, height: 900, background: '#ffffff', children: [] }],
    };

    const doc = migrateDoc(newDoc);

    expect(doc.outputs).toHaveLength(1);
    expect(doc.outputs[0].formatId).toBe('x-post');
    expect(doc.outputs[0].name).toBe('X Post');
  });
});

describe('Designer smoke: multi-format linked editing', () => {
  it('adds text and image across two tabs, undo removes from both, and legacy loads intact', () => {
    const store = createDesignerStore(1080, 1080);
    const { result } = renderHook(() => store());

    act(() => {
      result.current.addElement({
        id: '', type: 'text', x: 10, y: 10, width: 200, height: 40,
        rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Headline',
      });
    });

    act(() => {
      result.current.addOutput({ formatId: 'x-post', name: 'X Post', width: 1600, height: 900 });
    });

    // The same-origin text element should exist in both outputs.
    expect(result.current.doc.outputs[0].children).toHaveLength(1);
    expect(result.current.doc.outputs[1].children).toHaveLength(1);
    expect(result.current.doc.outputs[1].children[0].text).toBe('Headline');

    act(() => {
      result.current.addElement({
        id: '', type: 'image', x: 0, y: 0, width: 200, height: 200,
        rotation: 0, opacity: 1, locked: false, hidden: false, src: 'https://example.com/img.png',
      });
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(2);
    expect(result.current.doc.outputs[1].children).toHaveLength(2);

    act(() => {
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(1);
    expect(result.current.doc.outputs[1].children).toHaveLength(1);

    act(() => {
      result.current.loadDesign(
        {
          version: 1,
          width: 1080,
          height: 1080,
          pages: [{ id: 'legacy-page', background: '#eeeeee', children: [{ id: 'legacy-el', type: 'shape', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false, shape: 'rect' }] }],
        },
        'design-legacy',
        'Legacy Design'
      );
    });

    expect(result.current.doc.outputs).toHaveLength(1);
    expect(result.current.doc.outputs[0].children[0].type).toBe('shape');
  });
});
