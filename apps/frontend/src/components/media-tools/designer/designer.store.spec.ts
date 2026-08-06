import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createDesignerStore, migrateDoc, type DesignerStore } from './designer.store';
import {
  disposeAllBuffers,
  getBuffer,
  seedBufferFromImage,
} from './raster-layers';
import { DESIGNER_DOC_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';

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
      version: DESIGNER_DOC_VERSION,
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

describe('grouping a single layer', () => {
  it('wraps one selected layer in a group, as Photoshop does', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());

    act(() => {
      result.current.addElement({
        id: '', type: 'text', x: 0, y: 0, width: 100, height: 30,
        rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Solo',
      });
    });
    const soloId = result.current.doc.outputs[0].children[0].id;

    act(() => {
      result.current.setSelectedIds([soloId]);
      result.current.groupSelection();
    });

    const children = result.current.doc.outputs[0].children;
    const group = children.find((el) => el.type === 'group');
    expect(group).toBeTruthy();
    expect(children.find((el) => el.id === soloId)?.parentId).toBe(group?.id);
    expect(result.current.selectedIds).toEqual([group?.id]);
  });

  it('does nothing with an empty selection', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());

    act(() => {
      result.current.setSelectedIds([]);
      result.current.groupSelection();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(0);
  });
});

describe('rename requests', () => {
  it('carries the target to the layers panel and clears', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());

    expect(result.current.renamingId).toBeNull();
    act(() => result.current.requestRename('abc'));
    expect(result.current.renamingId).toBe('abc');
    act(() => result.current.requestRename(null));
    expect(result.current.renamingId).toBeNull();
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
    // A legacy doc is stamped with whatever the current schema version is;
    // asserting the constant keeps this from going stale on every bump.
    expect(doc.version).toBe(DESIGNER_DOC_VERSION);
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
      version: DESIGNER_DOC_VERSION,
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

describe('raster buffer lifecycle', () => {
  beforeEach(() => {
    // jsdom's canvas rejects drawImage of an unloaded Image; the pixels are
    // irrelevant here — only the buffer bookkeeping is under test. The
    // constructor isn't a jsdom global, so spy through a live context.
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      vi.spyOn(Object.getPrototypeOf(ctx), 'drawImage').mockImplementation(() => {});
    }
  });

  // The buffers are module-level, so each test leaves them as it found them.
  afterEach(() => {
    disposeAllBuffers();
    vi.restoreAllMocks();
  });

  const addRaster = (result: { current: DesignerStore }, src?: string): string => {
    act(() => {
      result.current.addElement({
        id: '', type: 'raster', x: 0, y: 0, width: 100, height: 100,
        rotation: 0, opacity: 1, locked: false, hidden: false, src,
      });
    });
    return result.current.doc.outputs[0].children[0].id;
  };

  it('disposes the buffer when the element is removed', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());
    const id = addRaster(result);
    seedBufferFromImage(id, new Image(), 100, 100);
    expect(getBuffer(id)).toBeTruthy();

    act(() => {
      result.current.removeElements([id]);
    });

    expect(getBuffer(id)).toBeUndefined();
  });

  it('disposes the buffer when undo reverts the element\u2019s creation', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());
    const id = addRaster(result);
    seedBufferFromImage(id, new Image(), 100, 100);

    act(() => {
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(0);
    expect(getBuffer(id)).toBeUndefined();
  });

  it('invalidates the live buffer when undo restores a different src', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());
    const id = addRaster(result, 'https://example.com/a.png');
    seedBufferFromImage(id, new Image(), 100, 100);

    act(() => {
      result.current.updateElement(id, { src: 'https://example.com/b.png' });
      result.current.pushHistory();
    });
    act(() => {
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children[0].src).toBe('https://example.com/a.png');
    // The stale buffer comes down synchronously; the re-seed from the restored
    // src is async (jsdom never fires img.onload, so it stays down here).
    expect(getBuffer(id)).toBeUndefined();
  });

  it('redo during undo\u2019s re-seed supersedes the stale load', () => {
    // The race: undo's re-seed deletes the buffer and starts loading the old
    // bitmap; redo used to find no buffer, skip the key, and the old pixels
    // then seeded over the redone document — the stroke silently vanished on
    // every quick undo-then-redo. The in-flight claim is what fixes it.
    const created: Array<{ src: string; onload?: () => void }> = [];
    vi.stubGlobal(
      'Image',
      class {
        onload?: () => void;
        onerror?: () => void;
        crossOrigin = '';
        width = 100;
        height = 100;
        private _src = '';
        get src() { return this._src; }
        set src(value: string) {
          this._src = value;
          created.push(this as never);
        }
      }
    );

    const store = createDesignerStore();
    const { result } = renderHook(() => store());
    const id = addRaster(result, 'https://example.com/old.png');
    seedBufferFromImage(id, document.createElement('canvas') as never, 100, 100);

    act(() => {
      result.current.updateElement(id, { src: 'https://example.com/new.png' });
      result.current.pushHistory();
    });
    act(() => {
      result.current.undo(); // starts the old.png load
    });
    act(() => {
      result.current.redo(); // must claim new.png and invalidate the old load
    });

    expect(created.map((img) => img.src)).toEqual([
      'https://example.com/old.png',
      'https://example.com/new.png',
    ]);

    // The stale load lands late — and must be discarded, not seeded.
    created[0].onload?.();
    expect(getBuffer(id)).toBeUndefined();

    // The current load lands — this one seeds.
    created[1].onload?.();
    expect(getBuffer(id)).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it('keeps the live buffer when undo leaves the element\u2019s src untouched', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());
    const id = addRaster(result);
    seedBufferFromImage(id, new Image(), 100, 100);

    act(() => {
      result.current.addElement({
        id: 'other', type: 'text', x: 0, y: 0, width: 100, height: 30,
        rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Unrelated',
      });
    });
    act(() => {
      result.current.undo();
    });

    expect(result.current.doc.outputs[0].children).toHaveLength(1);
    expect(getBuffer(id)).toBeTruthy();
  });

  it('disposes every buffer on reset', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => store());
    const id = addRaster(result);
    seedBufferFromImage(id, new Image(), 100, 100);

    act(() => {
      result.current.reset();
    });

    expect(getBuffer(id)).toBeUndefined();
  });
});
