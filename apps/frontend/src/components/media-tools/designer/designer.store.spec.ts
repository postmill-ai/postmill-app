import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createDesignerStore, migrateDoc, type DesignerStore } from './designer.store';
import {
  disposeAllBuffers,
  getBuffer,
  seedBufferFromImage,
} from './raster-layers';
import { DESIGNER_DOC_VERSION, MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import {
  hasSpeedCurve,
  sourceTimeForClipTime,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';

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
  it('adds text and image across two tabs, undo removes from both', () => {
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

describe('video track management', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('removeTrack drops the track and is undoable', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;

    store.getState().removeTrack(0, trackId);
    expect(vo(store).tracks).toHaveLength(0);

    store.getState().undo();
    expect(vo(store).tracks).toHaveLength(1);
  });

  it('renameTrack sets a custom name, and blank clears it back to the type label', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;

    store.getState().renameTrack(0, trackId, '  B-roll  ');
    expect(vo(store).tracks[0].name).toBe('B-roll');

    store.getState().renameTrack(0, trackId, '   ');
    expect(vo(store).tracks[0].name).toBeUndefined();

    store.getState().undo();
    expect(vo(store).tracks[0].name).toBe('B-roll');
  });

  it('setTrackMuted persists the flag and is undoable', () => {
    const store = videoStore();
    store.getState().addTrack(0, 'audio');
    const audio = vo(store).tracks.find((t) => t.type === 'audio')!;

    store.getState().setTrackMuted(0, audio.id, true);
    expect(vo(store).tracks.find((t) => t.id === audio.id)!.muted).toBe(true);

    store.getState().undo();
    expect(vo(store).tracks.find((t) => t.id === audio.id)!.muted).toBeUndefined();
  });
});

describe('duplicateClip', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('copies the clip right after the source with a fresh id and selects it', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'src', startMs: 1000, endMs: 3000, src: 'https://example.com/v.mp4',
      x: 10, y: 20, width: 100, height: 100,
    } as never);

    const newId = store.getState().duplicateClip(0, trackId, 'src');

    expect(newId).toBeTruthy();
    expect(newId).not.toBe('src');
    const clips = vo(store).tracks[0].clips;
    expect(clips).toHaveLength(2);
    const copy = clips.find((c) => c.id === newId)!;
    expect(copy.startMs).toBe(3000);
    expect(copy.endMs).toBe(5000);
    expect(copy.src).toBe('https://example.com/v.mp4');
    expect(copy.x).toBe(10);
    expect(store.getState().selectedClip?.clipId).toBe(newId);
    // One undo removes the whole gesture (no half-extended duration step).
    store.getState().undo();
    expect(vo(store).tracks[0].clips).toHaveLength(1);
  });

  it('extends the output duration when the copy would overflow', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    const durationMs = vo(store).durationMs;
    store.getState().addClip(0, trackId, {
      id: 'src', startMs: durationMs - 2000, endMs: durationMs, src: 'https://example.com/v.mp4',
    } as never);

    const newId = store.getState().duplicateClip(0, trackId, 'src');

    expect(newId).toBeTruthy();
    expect(vo(store).durationMs).toBe(durationMs + 2000);
    const copy = vo(store).tracks[0].clips.find((c) => c.id === newId)!;
    expect(copy.endMs).toBe(durationMs + 2000);
  });

  it('starts after the freeze extension rather than the raw end', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'src', startMs: 0, endMs: 2000, freezeAtMs: 1500, src: 'https://example.com/v.mp4',
    } as never);

    const newId = store.getState().duplicateClip(0, trackId, 'src');

    const copy = vo(store).tracks[0].clips.find((c) => c.id === newId)!;
    expect(copy.startMs).toBe(3500);
    // The freeze hold itself is not duplicated.
    expect(copy.freezeAtMs).toBeUndefined();
  });

  it('returns null when there is no room even at the MAX_VIDEO_DURATION_MS ceiling', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().setVideoDuration(0, MAX_VIDEO_DURATION_MS);
    store.getState().addClip(0, trackId, {
      id: 'src', startMs: MAX_VIDEO_DURATION_MS - 5000, endMs: MAX_VIDEO_DURATION_MS, src: 'https://example.com/v.mp4',
    } as never);

    expect(store.getState().duplicateClip(0, trackId, 'src')).toBeNull();
    expect(vo(store).tracks[0].clips).toHaveLength(1);
  });
});

describe('multi-clip selection', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('setSelectedClip keeps selectedClips in sync with the primary', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    expect(store.getState().selectedClips).toEqual([{ trackId, clipId: 'a' }]);

    store.getState().setSelectedClip(null);
    expect(store.getState().selectedClips).toEqual([]);
  });

  it('toggleClipSelection adds/removes members and moves the primary', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);
    store.getState().addClip(0, trackId, { id: 'b', startMs: 1000, endMs: 2000 } as never);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    store.getState().toggleClipSelection(trackId, 'b');
    expect(store.getState().selectedClips).toEqual([
      { trackId, clipId: 'a' },
      { trackId, clipId: 'b' },
    ]);
    // The just-added clip drives the inspector.
    expect(store.getState().selectedClip?.clipId).toBe('b');

    // Removing the primary promotes the last remaining member.
    store.getState().toggleClipSelection(trackId, 'b');
    expect(store.getState().selectedClips).toEqual([{ trackId, clipId: 'a' }]);
    expect(store.getState().selectedClip?.clipId).toBe('a');
  });

  it('setSelectedClips reassigns a primary that fell out of the set', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);
    store.getState().addClip(0, trackId, { id: 'b', startMs: 1000, endMs: 2000 } as never);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    store.getState().setSelectedClips([{ trackId, clipId: 'b' }]);
    expect(store.getState().selectedClip?.clipId).toBe('b');

    store.getState().setSelectedClips([]);
    expect(store.getState().selectedClip).toBeNull();
  });

  it('selection changes never touch the undo history', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);
    const depth = store.getState().history.length;

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    store.getState().toggleClipSelection(trackId, 'a');
    store.getState().setSelectedClips([{ trackId, clipId: 'a' }]);
    expect(store.getState().history.length).toBe(depth);
  });
});

describe('rippleDeleteClip', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('shifts same-track successors left by the removed duration, one history entry', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);
    store.getState().addClip(0, trackId, { id: 'b', startMs: 1000, endMs: 3000 } as never);
    store.getState().addClip(0, trackId, { id: 'c', startMs: 4000, endMs: 5000 } as never);
    const depth = store.getState().history.length;

    store.getState().rippleDeleteClip(0, trackId, 'b');

    const clips = vo(store).tracks[0].clips;
    expect(clips.map((c) => c.id)).toEqual(['a', 'c']);
    // c moves left by b's 2000 ms, keeping its own 1000 ms duration.
    expect(clips[1].startMs).toBe(2000);
    expect(clips[1].endMs).toBe(3000);
    // a starts before the removed clip — untouched.
    expect(clips[0].startMs).toBe(0);
    expect(store.getState().history.length).toBe(depth + 1);

    store.getState().undo();
    expect(vo(store).tracks[0].clips.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('honors the freeze extension and clamps at t=0', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 500, endMs: 2000, freezeAtMs: 1000 } as never);
    store.getState().addClip(0, trackId, { id: 'b', startMs: 3200, endMs: 4000 } as never);

    store.getState().rippleDeleteClip(0, trackId, 'a');

    // Effective duration is 2500 (1500 + 1000 freeze); b moves left by 2500.
    const b = vo(store).tracks[0].clips.find((c) => c.id === 'b')!;
    expect(b.startMs).toBe(700);
    expect(b.endMs).toBe(1500);
  });

  it('clamps a successor at t=0 without going negative, preserving duration', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 3000 } as never);
    store.getState().addClip(0, trackId, { id: 'b', startMs: 2000, endMs: 3000 } as never);

    store.getState().rippleDeleteClip(0, trackId, 'a');

    // Shift (3000) exceeds b's start — it pins to 0 and keeps its 1000 ms.
    const b = vo(store).tracks[0].clips.find((c) => c.id === 'b')!;
    expect(b.startMs).toBe(0);
    expect(b.endMs).toBe(1000);
  });

  it('leaves other tracks alone and drops the removed clip from the selection', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'audio');
    const audioId = vo(store).tracks.find((t) => t.type === 'audio')!.id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);
    store.getState().addClip(0, audioId, { id: 'm', startMs: 1000, endMs: 2000 } as never);
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });

    store.getState().rippleDeleteClip(0, trackId, 'a');

    const m = vo(store).tracks.find((t) => t.id === audioId)!.clips[0];
    expect(m.startMs).toBe(1000);
    expect(store.getState().selectedClip).toBeNull();
    expect(store.getState().selectedClips).toEqual([]);
  });
});

describe('clip copy/paste', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('pastes the group so the earliest clip lands at the playhead, with fresh ids, and selects the paste', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'audio');
    const audioId = vo(store).tracks.find((t) => t.type === 'audio')!.id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 2000, endMs: 4000, src: 'v.mp4' } as never);
    store.getState().addClip(0, audioId, { id: 'm', startMs: 3000, endMs: 5000, src: 'a.mp3' } as never);
    store.getState().setSelectedClips([
      { trackId, clipId: 'a' },
      { trackId: audioId, clipId: 'm' },
    ]);
    const depth = store.getState().history.length;

    store.getState().copySelectedClips();
    store.getState().pasteClips(10000);

    const video = vo(store).tracks.find((t) => t.id === trackId)!;
    const audio = vo(store).tracks.find((t) => t.id === audioId)!;
    const pastedV = video.clips.find((c) => c.id !== 'a')!;
    const pastedA = audio.clips.find((c) => c.id !== 'm')!;
    // Group offset: earliest copied clip (a at 2000) lands at 10000 → +8000.
    expect(pastedV.startMs).toBe(10000);
    expect(pastedV.endMs).toBe(12000);
    expect(pastedA.startMs).toBe(11000);
    expect(pastedA.endMs).toBe(13000);
    expect(pastedV.id).not.toBe('a');
    expect(pastedA.id).not.toBe('m');
    // Sources are deep-cloned, not shared references.
    expect(pastedV).not.toBe(video.clips[0]);
    // One undo step for the whole paste.
    expect(store.getState().history.length).toBe(depth + 1);
    // The pasted clips become the selection.
    expect(store.getState().selectedClips).toEqual([
      { trackId, clipId: pastedV.id },
      { trackId: audioId, clipId: pastedA.id },
    ]);

    store.getState().undo();
    expect(vo(store).tracks.find((t) => t.id === trackId)!.clips).toHaveLength(1);
  });

  it('falls back to the first track of the same type, creating one when absent', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000, src: 'v.mp4' } as never);
    store.getState().addTrack(0, 'audio');
    const audioId = vo(store).tracks.find((t) => t.type === 'audio')!.id;
    store.getState().addClip(0, audioId, { id: 'm', startMs: 0, endMs: 1000, src: 'a.mp3' } as never);
    store.getState().setSelectedClips([
      { trackId, clipId: 'a' },
      { trackId: audioId, clipId: 'm' },
    ]);
    store.getState().copySelectedClips();

    // Delete the audio track — the paste must recreate one of the same type.
    store.getState().removeTrack(0, audioId);
    store.getState().pasteClips(0);

    const audioTracks = vo(store).tracks.filter((t) => t.type === 'audio');
    expect(audioTracks).toHaveLength(1);
    expect(audioTracks[0].clips).toHaveLength(1);
    expect(audioTracks[0].clips[0].src).toBe('a.mp3');
  });

  it('extends the output duration like duplicateClip and skips what still overflows', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    const durationMs = vo(store).durationMs;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 2000, src: 'v.mp4' } as never);
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    store.getState().copySelectedClips();

    // Playhead near the end: the paste extends the output to fit.
    store.getState().pasteClips(durationMs - 500);
    expect(vo(store).durationMs).toBe(durationMs + 1500);
    const pasted = vo(store).tracks[0].clips.find((c) => c.id !== 'a')!;
    expect(pasted.startMs).toBe(durationMs - 500);

    // At the MAX_VIDEO_DURATION_MS ceiling there is no room — nothing is pasted, no history.
    store.getState().setVideoDuration(0, MAX_VIDEO_DURATION_MS);
    const depth = store.getState().history.length;
    const count = vo(store).tracks[0].clips.length;
    store.getState().pasteClips(MAX_VIDEO_DURATION_MS - 100);
    expect(vo(store).tracks[0].clips.length).toBe(count);
    expect(store.getState().history.length).toBe(depth);
  });
});


describe('speed-ramped clips in the store', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  // 1× ramping to 3× by 1000ms, then holding 3× (mirrors the module's RAMP).
  const RAMP = [
    { atMs: 0, speed: 1 },
    { atMs: 1000, speed: 3 },
  ];

  it('splitClip splits the curve at the cut and keeps the source continuous', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'c1', startMs: 0, endMs: 4000, src: 'v.mp4', trimInMs: 300, speedCurve: RAMP,
    } as never);
    const depth = store.getState().history.length;

    store.getState().splitClip(0, trackId, 'c1', 1500);

    const clips = vo(store).tracks[0].clips;
    expect(clips).toHaveLength(2);
    const [first, second] = clips;
    expect(first.endMs).toBe(1500);
    expect(second.startMs).toBe(1500);
    // Each side carries its own re-based curve…
    expect(hasSpeedCurve(first)).toBe(true);
    expect(hasSpeedCurve(second)).toBe(true);
    // …and the two halves compose to the original mapping exactly.
    const original = { startMs: 0, endMs: 4000, trimInMs: 300, speedCurve: RAMP };
    for (const l of [0, 500, 1000, 1500]) {
      expect(sourceTimeForClipTime(first, l)).toBeCloseTo(sourceTimeForClipTime(original, l), 9);
    }
    expect(second.trimInMs).toBeCloseTo(sourceTimeForClipTime(original, 1500), 9);
    for (const l of [0, 1000, 2500]) {
      expect(sourceTimeForClipTime(second, l)).toBeCloseTo(sourceTimeForClipTime(original, 1500 + l), 9);
    }
    // One undo step restores the unsplit clip.
    expect(store.getState().history.length).toBe(depth + 1);
    store.getState().undo();
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    expect(vo(store).tracks[0].clips[0].speedCurve).toEqual(RAMP);
  });

  it('splitClip on a reversed ramp keeps the second half on the original trim-in', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'c1', startMs: 0, endMs: 4000, src: 'v.mp4', trimInMs: 300, reverse: true, speedCurve: RAMP,
    } as never);

    store.getState().splitClip(0, trackId, 'c1', 1500);

    const [first, second] = vo(store).tracks[0].clips;
    const original = { startMs: 0, endMs: 4000, trimInMs: 300, reverse: true, speedCurve: RAMP };
    for (const l of [0, 700, 1500]) {
      expect(sourceTimeForClipTime(first, l)).toBeCloseTo(sourceTimeForClipTime(original, l), 9);
    }
    expect(second.trimInMs).toBe(300);
    for (const l of [0, 1250, 2500]) {
      expect(sourceTimeForClipTime(second, l)).toBeCloseTo(sourceTimeForClipTime(original, 1500 + l), 9);
    }
  });

  it('duplicateClip and pasteClips carry the curve', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'src', startMs: 0, endMs: 2000, src: 'v.mp4', speedCurve: RAMP,
    } as never);

    const newId = store.getState().duplicateClip(0, trackId, 'src')!;
    expect(vo(store).tracks[0].clips.find((c) => c.id === newId)!.speedCurve).toEqual(RAMP);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'src' });
    store.getState().copySelectedClips();
    store.getState().pasteClips(6000);
    const pasted = vo(store).tracks[0].clips.find((c) => c.id !== 'src' && c.id !== newId)!;
    expect(pasted.speedCurve).toEqual(RAMP);
  });
});

describe('track lock / hide, markers, and timeline view prefs', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('setTrackLocked / setTrackHidden persist the flags and are undoable', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;

    store.getState().setTrackLocked(0, trackId, true);
    store.getState().setTrackHidden(0, trackId, true);
    expect(vo(store).tracks[0].locked).toBe(true);
    expect(vo(store).tracks[0].hidden).toBe(true);

    store.getState().undo();
    expect(vo(store).tracks[0].hidden).toBeUndefined();
    store.getState().undo();
    expect(vo(store).tracks[0].locked).toBeUndefined();
  });

  it('a locked track refuses delete and split, an unlocked one accepts them', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'c1', startMs: 0, endMs: 4000, src: 'v.mp4' } as never);
    store.getState().setTrackLocked(0, trackId, true);
    const historyBefore = store.getState().historyIndex;

    store.getState().removeClip(0, trackId, 'c1');
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    store.getState().splitClip(0, trackId, 'c1', 2000);
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    // A refused edit must not leave an empty undo step.
    expect(store.getState().historyIndex).toBe(historyBefore);

    store.getState().rippleDeleteClip(0, trackId, 'c1');
    expect(vo(store).tracks[0].clips).toHaveLength(1);

    store.getState().setTrackLocked(0, trackId, false);
    store.getState().splitClip(0, trackId, 'c1', 2000);
    expect(vo(store).tracks[0].clips).toHaveLength(2);
    store.getState().removeClips(0, [{ trackId, clipId: vo(store).tracks[0].clips[0].id }]);
    expect(vo(store).tracks[0].clips).toHaveLength(1);
  });

  it('removeClips skips only the locked-track refs in a mixed selection', () => {
    const store = videoStore();
    const t1 = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'video');
    const t2 = vo(store).tracks[1].id;
    store.getState().addClip(0, t1, { id: 'a', startMs: 0, endMs: 2000, src: 'v.mp4' } as never);
    store.getState().addClip(0, t2, { id: 'b', startMs: 0, endMs: 2000, src: 'v2.mp4' } as never);
    store.getState().setTrackLocked(0, t1, true);

    store.getState().removeClips(0, [
      { trackId: t1, clipId: 'a' },
      { trackId: t2, clipId: 'b' },
    ]);
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    expect(vo(store).tracks[1].clips).toHaveLength(0);
  });

  it('markers add (sorted, clamped), rename, delete — each undoable', () => {
    const store = videoStore();

    const id1 = store.getState().addMarker(0, 5000, 'Hook')!;
    const id2 = store.getState().addMarker(0, 1000)!;
    expect(vo(store).markers?.map((m) => m.id)).toEqual([id2, id1]);
    expect(vo(store).markers?.[1].name).toBe('Hook');

    // Clamped into the timeline.
    const id3 = store.getState().addMarker(0, 999999)!;
    expect(vo(store).markers?.find((m) => m.id === id3)?.tMs).toBe(vo(store).durationMs);

    store.getState().renameMarker(0, id2, 'Intro');
    expect(vo(store).markers?.find((m) => m.id === id2)?.name).toBe('Intro');
    store.getState().renameMarker(0, id2, '   ');
    expect(vo(store).markers?.find((m) => m.id === id2)?.name).toBeUndefined();

    store.getState().removeMarker(0, id1);
    expect(vo(store).markers?.some((m) => m.id === id1)).toBe(false);

    store.getState().undo();
    expect(vo(store).markers?.some((m) => m.id === id1)).toBe(true);
  });

  it('removing the last marker clears the field (doc stays additive-clean)', () => {
    const store = videoStore();
    const id = store.getState().addMarker(0, 1000)!;
    store.getState().removeMarker(0, id);
    expect(vo(store).markers).toBeUndefined();
  });

  it('timelineSnap toggles and timelineHeight clamps, without touching history', () => {
    const store = videoStore();
    const historyBefore = store.getState().historyIndex;

    expect(store.getState().timelineSnap).toBe(true);
    store.getState().setTimelineSnap(false);
    expect(store.getState().timelineSnap).toBe(false);

    store.getState().setTimelineHeight(20);
    expect(store.getState().timelineHeight).toBe(120);
    store.getState().setTimelineHeight(9999);
    expect(store.getState().timelineHeight).toBe(600);

    expect(store.getState().historyIndex).toBe(historyBefore);
  });
});
