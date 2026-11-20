import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createDesignerStore, migrateDoc, MAX_TRACKS, type DesignerDoc, type DesignerOutput, type DesignerStore } from './designer.store';
import { subscribeToBaseDocument } from './collaboration-doc';

/**
 * Focal detection is an async vision call; the store only consumes its
 * promise. Default to a never-resolving promise (jsdom's Image never fires
 * onload, so this mirrors the unmocked behavior) — focal tests set
 * `focalMock.result` per case. A plain factory function (not vi.fn) so
 * restoreAllMocks in other describes can't neuter the default.
 */
const focalMock = vi.hoisted(() => ({
  result: null as { x: number; y: number } | null,
}));
vi.mock('./reflow', () => ({
  detectFocalPoint: (src: string) => {
    void src;
    return focalMock.result
      ? Promise.resolve(focalMock.result)
      : new Promise<{ x: number; y: number }>(() => {});
  },
}));
import {
  disposeAllBuffers,
  getBuffer,
  seedBufferFromImage,
} from './raster-layers';
import { DESIGNER_DOC_VERSION, MAX_OUTPUTS, MAX_PAGES_PER_OUTPUT, MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
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
  it.each([
    {
      formatId: 'ig-post', name: 'Instagram Post', width: 1080, height: 1080,
      kicker: { x: 54, y: 54 }, legal: { x: 54, y: 986 },
    },
    {
      formatId: 'yt-thumbnail', name: 'YouTube Thumbnail', width: 1280, height: 720,
      kicker: { x: 64, y: 36 }, legal: { x: 64, y: 648 },
    },
  ])('keeps generic margins when adding $formatId with visual safe zones', (target) => {
    const store = createDesignerStore(1080, 1080);
    act(() => {
      store.getState().addElement({
        id: 'kicker', originId: 'kicker', type: 'text', x: 60, y: 60, width: 200, height: 40,
        rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Kicker',
      });
      store.getState().addElement({
        id: 'legal', originId: 'legal', type: 'text', x: 60, y: 990, width: 400, height: 40,
        rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Legal',
      });
      store.getState().addOutput(target);
    });

    const children = (store.getState().doc.outputs[1] as any).children;
    const kicker = children.find((element: any) => element.originId === 'kicker');
    const legal = children.find((element: any) => element.originId === 'legal');
    expect(kicker).toMatchObject(target.kicker);
    expect(legal).toMatchObject(target.legal);
    expect(kicker.x).not.toBe(0);
    expect(legal.x).not.toBe(0);
  });

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

describe('rich-text output reflow', () => {
  it('scales explicit runs on Add format and resize while preserving inheritance', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().addElement({
      id: 'rich-source', originId: 'rich-source', type: 'text',
      text: 'Big rich headline', fontSize: 64, fontFamily: 'Inter', fontWeight: 400,
      richText: [
        { text: 'Big ', fontSize: 64, fontWeight: 700, fill: '#112233' },
        { text: 'rich ', fontSize: 32, fontStyle: 'italic' },
        { text: 'headline', fontWeight: 500 },
      ],
      x: 100, y: 100, width: 600, height: 100, rotation: 0,
      opacity: 1, locked: false, hidden: false,
    });
    const source = store.getState().doc.outputs[0] as DesignerOutput;
    const sourceJson = JSON.stringify(source);

    expect(store.getState().addOutput({
      formatId: 'custom', name: 'Small wide', width: 600, height: 400,
    })).toBe(true);

    const added = store.getState().doc.outputs[1] as DesignerOutput;
    expect(added.children[0].fontSize).toBe(29);
    expect(added.children[0].originId).toBe('rich-source');
    expect(added.children[0].richText).toEqual([
      { text: 'Big ', fontSize: 29, fontWeight: 700, fill: '#112233' },
      { text: 'rich ', fontSize: 15, fontStyle: 'italic' },
      { text: 'headline', fontWeight: 500 },
    ]);
    expect(added.children[0].richText?.[2]).not.toHaveProperty('fontSize');
    expect(JSON.stringify(source)).toBe(sourceJson);

    store.getState().resizeOutput(0, 540, 540, 'custom', 'Half size');

    const resized = store.getState().doc.outputs[0] as DesignerOutput;
    expect(resized.children[0].fontSize).toBe(32);
    expect(resized.children[0].richText?.map((run) => run.fontSize)).toEqual([
      32, 16, undefined,
    ]);
    expect(resized.children[0].richText?.[2]).not.toHaveProperty('fontSize');
  });
});

describe('format-local element insertion', () => {
  afterEach(() => {
    focalMock.result = null;
  });

  const makeElement = (type: 'text' | 'image' | 'shape', id: string) => ({
    id,
    type,
    x: 20,
    y: 30,
    width: 200,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...(type === 'text' ? { text: 'Inserted', fontSize: 32 } : {}),
    ...(type === 'image' ? { src: 'https://example.com/inserted.png' } : {}),
    ...(type === 'shape' ? { shape: 'rect' } : {}),
  }) as any;

  const storeWithLinkedAndIndependentOutputs = () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Linked', width: 1200, height: 675 });
    store.getState().addOutput(
      { formatId: 'ig-story', name: 'Independent', width: 1080, height: 1920 },
      { linkContent: false }
    );
    store.getState().setCurrentOutput(0);
    return store;
  };

  const storeWithLegacyLinkedPair = () => {
    const store = createDesignerStore();
    store.getState().addElement(makeElement('text', 'legacy-source'));
    store.getState().addOutput({ formatId: 'x-post', name: 'Legacy linked', width: 1200, height: 675 });
    const legacyDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out) => ({
        ...out,
        contentLinkGroup: undefined,
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);
    store.getState().setCurrentOutput(0);
    return store;
  };

  it.each(['text', 'image', 'shape'] as const)(
    'This format only inserts %s on the active output with one Undo',
    (type) => {
      const store = storeWithLinkedAndIndependentOutputs();
      const origins = store.getState().doc.outputs.map((out) =>
        out.children.map((el) => el.originId)
      );
      const historyLength = store.getState().history.length;
      store.getState().setEditFormatOnly(true);

      store.getState().addElement(makeElement(type, `local-${type}`));

      expect(store.getState().doc.outputs.map((out) => out.children)).toHaveLength(3);
      expect(store.getState().doc.outputs[0].children).toHaveLength(2);
      expect(store.getState().doc.outputs[1].children).toHaveLength(1);
      expect(store.getState().doc.outputs[2].children).toHaveLength(1);
      expect(store.getState().doc.outputs.map((out) =>
        out.children.slice(0, 1).map((el) => el.originId)
      )).toEqual(origins);
      expect(store.getState().history).toHaveLength(historyLength + 1);

      store.getState().undo();
      expect(store.getState().doc.outputs.every((out) => out.children.length === 1)).toBe(true);
    }
  );

  it.each(['text', 'image', 'shape'] as const)(
    '%s insertion respects independent outputs in both directions',
    (type) => {
      const store = storeWithLinkedAndIndependentOutputs();
      const sourceOrigins = store.getState().doc.outputs.map((out) => out.children[0].originId);
      store.getState().setCurrentOutput(2);

      store.getState().addElement(makeElement(type, `independent-${type}`));

      expect(store.getState().doc.outputs[0].children).toHaveLength(1);
      expect(store.getState().doc.outputs[1].children).toHaveLength(1);
      expect(store.getState().doc.outputs[2].children).toHaveLength(2);
      expect(store.getState().doc.outputs.map((out) => out.children[0].originId)).toEqual(sourceOrigins);

      const independentId = store.getState().doc.outputs[2].children[0].id;
      store.getState().updateElement(independentId, { text: 'Independent edit' });
      expect(store.getState().doc.outputs[0].children[0].text).toBe('Original');
      expect(store.getState().doc.outputs[1].children[0].text).toBe('Original');

      store.getState().undo();
      store.getState().setCurrentOutput(0);
      store.getState().addElement(makeElement(type, `linked-${type}`));

      const outputs = store.getState().doc.outputs;
      expect(outputs[0].children).toHaveLength(2);
      expect(outputs[1].children).toHaveLength(2);
      expect(outputs[2].children).toHaveLength(1);
      expect(outputs[1].children[1].id).not.toBe(outputs[0].children[1].id);
      expect(outputs[1].children[1].originId).toBe(outputs[0].children[1].originId);
      expect(outputs[2].children[0].originId).toBeUndefined();

      store.getState().undo();
      expect(store.getState().doc.outputs.every((out) => out.children.length === 1)).toBe(true);
    }
  );

  it.each(['text', 'image', 'shape'] as const)(
    'later-page %s insertion stays local while linking is enabled',
    (type) => {
      const store = storeWithLinkedAndIndependentOutputs();
      store.getState().setCurrentOutput(1);
      store.getState().addPage();

      store.getState().addElement(makeElement(type, `page-two-${type}`));

      const outputs = store.getState().doc.outputs as any[];
      expect(outputs[0].children).toHaveLength(1);
      expect(outputs[1].children).toHaveLength(1);
      expect(outputs[1].pages[0].children).toHaveLength(1);
      expect(outputs[2].children).toHaveLength(1);
      expect(outputs[2].pages).toBeUndefined();
    }
  );

  it('keeps an empty independent copy local without suppressing empty linked formats', () => {
    const independentStore = createDesignerStore();
    independentStore.getState().addOutput(
      { formatId: 'x-post', name: 'Independent', width: 1200, height: 675 },
      { linkContent: false }
    );

    independentStore.getState().addElement(makeElement('shape', 'empty-independent-shape'));

    expect(independentStore.getState().doc.outputs.map((out) => out.children.length)).toEqual([0, 1]);
    const groups = independentStore.getState().doc.outputs.map((out) => out.contentLinkGroup);
    expect(groups[0]).toBeDefined();
    expect(groups[1]).toBeDefined();
    expect(groups[1]).not.toBe(groups[0]);

    const linkedStore = createDesignerStore();
    linkedStore.getState().addOutput({ formatId: 'x-post', name: 'Linked', width: 1200, height: 675 });
    linkedStore.getState().setCurrentOutput(0);
    linkedStore.getState().addElement(makeElement('shape', 'empty-linked-shape'));
    expect(linkedStore.getState().doc.outputs.map((out) => out.children.length)).toEqual([1, 1]);
  });

  it('detects legacy independent copies by their lack of shared origins', () => {
    const store = storeWithLinkedAndIndependentOutputs();
    const legacyDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out) => {
        const { contentLinkGroup, ...legacyOut } = out;
        void contentLinkGroup;
        return legacyOut;
      }),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);
    store.getState().setCurrentOutput(2);

    store.getState().addElement(makeElement('shape', 'legacy-independent-shape'));

    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([1, 1, 2]);
    store.getState().setCurrentOutput(0);
    store.getState().addElement(makeElement('shape', 'legacy-linked-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 2, 2]);
  });

  it('keeps every legacy linked format together across adds from different tabs', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Legacy B', width: 1200, height: 675 });
    const legacyDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out) => ({
        ...out,
        contentLinkGroup: undefined,
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);

    store.getState().setCurrentOutput(1);
    store.getState().addOutput({ formatId: 'linkedin-post', name: 'Linked E', width: 1200, height: 627 });
    store.getState().setCurrentOutput(0);
    store.getState().addOutput({ formatId: 'ig-story', name: 'Linked F', width: 1080, height: 1920 });

    const groups = store.getState().doc.outputs.map((out) => out.contentLinkGroup);
    expect(groups[0]).toBeDefined();
    expect(new Set(groups).size).toBe(1);
    store.getState().addElement(makeElement('shape', 'legacy-a-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 2, 2, 2]);
    store.getState().setCurrentOutput(1);
    store.getState().addElement(makeElement('shape', 'legacy-b-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([3, 3, 3, 3]);
  });

  it('backfills a legacy empty format when a linked format is added', () => {
    const store = createDesignerStore();
    store.getState().addElement(makeElement('text', 'legacy-source'));
    store.getState().addOutput({ formatId: 'x-post', name: 'Legacy empty', width: 1200, height: 675 });
    const legacyDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out, index) => ({
        ...out,
        contentLinkGroup: undefined,
        children: index === 1 ? [] : out.children,
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);
    store.getState().setCurrentOutput(0);

    store.getState().addOutput({ formatId: 'linkedin-post', name: 'Linked new', width: 1200, height: 627 });
    const groups = store.getState().doc.outputs.map((out) => out.contentLinkGroup);
    expect(groups[0]).toBeDefined();
    expect(groups).toEqual([groups[0], groups[0], groups[0]]);
    store.getState().addElement(makeElement('shape', 'legacy-empty-after-add'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 1, 2]);
  });

  it('seeds a legacy empty format without explicit groups', () => {
    const store = createDesignerStore();
    store.getState().addElement(makeElement('text', 'legacy-source'));
    store.getState().addOutput({ formatId: 'x-post', name: 'Legacy empty', width: 1200, height: 675 });
    const legacyDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out, index) => ({
        ...out,
        contentLinkGroup: undefined,
        children: index === 1 ? [] : out.children,
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);
    store.getState().setCurrentOutput(0);

    store.getState().addElement(makeElement('shape', 'legacy-empty-shape'));

    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 1]);
  });

  it('allows linked Add Format with a frozen legacy sibling without changing it', () => {
    const store = storeWithLegacyLinkedPair();
    store.getState().setOutputFrozen(1, true);
    const frozenBefore = store.getState().doc.outputs[1];

    expect(store.getState().addOutput(
      { formatId: 'linkedin-post', name: 'New linked', width: 1200, height: 627 }
    )).toBe(true);

    const outputs = store.getState().doc.outputs;
    expect(outputs).toHaveLength(3);
    expect(outputs[1]).toEqual(frozenBefore);
    expect(outputs[0].contentLinkGroup).toBeDefined();
    expect(outputs[2].contentLinkGroup).toBe(outputs[0].contentLinkGroup);
  });

  it('allows linked Add Format with a frozen legacy source without changing it', () => {
    const store = storeWithLegacyLinkedPair();
    store.getState().setOutputFrozen(0, true);
    const frozenBefore = store.getState().doc.outputs[0];

    expect(store.getState().addOutput(
      { formatId: 'linkedin-post', name: 'New linked', width: 1200, height: 627 }
    )).toBe(true);

    const outputs = store.getState().doc.outputs;
    expect(outputs).toHaveLength(3);
    expect(outputs[0]).toEqual(frozenBefore);
    expect(outputs[2].contentLinkGroup).toBeDefined();
    expect(outputs[2].contentLinkGroup).toBe(outputs[1].contentLinkGroup);
  });

  it('adopts the existing group when adding from a previously frozen legacy sibling', () => {
    const store = storeWithLegacyLinkedPair();
    store.getState().setOutputFrozen(1, true);
    expect(store.getState().addOutput(
      { formatId: 'linkedin-post', name: 'New linked', width: 1200, height: 627 }
    )).toBe(true);
    store.getState().setOutputFrozen(1, false);
    store.getState().setCurrentOutput(1);

    expect(store.getState().addOutput(
      { formatId: 'ig-story', name: 'Second new linked', width: 1080, height: 1920 }
    )).toBe(true);

    const groups = store.getState().doc.outputs.map((out) => out.contentLinkGroup);
    expect(groups[0]).toBeDefined();
    expect(groups).toEqual([groups[0], groups[0], groups[0], groups[0]]);
  });

  it('does not use the legacy empty fallback for a grouped independent copy', () => {
    const store = createDesignerStore();
    const legacyDoc = {
      ...store.getState().doc,
      outputs: [{ ...store.getState().doc.outputs[0], contentLinkGroup: undefined }],
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);
    store.getState().addOutput(
      { formatId: 'x-post', name: 'Independent empty', width: 1200, height: 675 },
      { linkContent: false }
    );
    store.getState().setCurrentOutput(0);

    store.getState().addElement(makeElement('shape', 'legacy-only-shape'));

    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([1, 0]);
  });

  it('keeps a linked copy made from an independent copy in that independent link group', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput(
      { formatId: 'x-post', name: 'Independent C', width: 1200, height: 675 },
      { linkContent: false }
    );
    store.getState().addOutput({ formatId: 'linkedin-post', name: 'Linked D', width: 1200, height: 627 });

    const initialGroups = store.getState().doc.outputs.map((out) => out.contentLinkGroup);
    expect(initialGroups[1]).toBe(initialGroups[2]);
    expect(initialGroups[0]).not.toBe(initialGroups[1]);
    store.getState().setCurrentOutput(0);
    const independentBefore = store.getState().doc.outputs[1];
    const linkedBefore = store.getState().doc.outputs[2];
    store.getState().addElement(makeElement('shape', 'first-format-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 1, 1]);
    expect(store.getState().doc.outputs[1]).toBe(independentBefore);
    expect(store.getState().doc.outputs[2]).toBe(linkedBefore);

    store.getState().setCurrentOutput(1);
    const firstBefore = store.getState().doc.outputs[0];
    store.getState().addElement(makeElement('shape', 'independent-group-shape'));
    const outputs = store.getState().doc.outputs;
    expect(outputs.map((out) => out.children.length)).toEqual([2, 2, 2]);
    expect(outputs[0]).toBe(firstBefore);
    expect(outputs[2].children[1].originId).toBe(outputs[1].children[1].originId);
  });

  it('does not mix a legacy independent copy with a new linked group', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput(
      { formatId: 'x-post', name: 'Legacy independent C', width: 1200, height: 675 },
      { linkContent: false }
    );
    const legacyDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out) => {
        const { contentLinkGroup, ...legacyOut } = out;
        void contentLinkGroup;
        return legacyOut;
      }),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(legacyDoc);
    store.getState().setCurrentOutput(0);
    store.getState().addOutput({ formatId: 'linkedin-post', name: 'Linked D', width: 1200, height: 627 });

    const groups = store.getState().doc.outputs.map((out) => out.contentLinkGroup);
    expect(groups[0]).toBeDefined();
    expect(groups[0]).toBe(groups[2]);
    expect(groups[1]).toBeUndefined();
    store.getState().setCurrentOutput(1);
    store.getState().addElement(makeElement('shape', 'legacy-independent-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([1, 2, 1]);

    store.getState().setCurrentOutput(0);
    const independentAfterLocal = store.getState().doc.outputs[1];
    store.getState().addElement(makeElement('shape', 'legacy-linked-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 2, 2]);
    expect(store.getState().doc.outputs[1]).toBe(independentAfterLocal);
  });

  it('uses shared origins symmetrically when only one output has a link group', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Grouped', width: 1200, height: 675 });
    const mixedDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out, index) => ({
        ...out,
        contentLinkGroup: index === 0 ? undefined : out.contentLinkGroup,
        children: out.children.map((child) => ({ ...child, originId: child.id })),
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(mixedDoc);

    store.getState().setCurrentOutput(0);
    const groupedBefore = store.getState().doc.outputs[1];
    store.getState().addElement(makeElement('shape', 'legacy-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 1]);
    expect(store.getState().doc.outputs[1]).toBe(groupedBefore);

    store.getState().setCurrentOutput(1);
    const legacyBefore = store.getState().doc.outputs[0];
    store.getState().addElement(makeElement('shape', 'grouped-shape'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 2]);
    expect(store.getState().doc.outputs[0]).toBe(legacyBefore);
  });

  it('keeps re-minted outputs with the same link group linked in both directions', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Grouped', width: 1200, height: 675 });
    const group = store.getState().doc.outputs[0].contentLinkGroup;
    const remintedDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out) => ({
        ...out,
        contentLinkGroup: group,
        children: out.children.map((child) => ({ ...child, originId: child.id })),
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(remintedDoc);

    store.getState().setCurrentOutput(0);
    store.getState().addElement(makeElement('shape', 'reminted-linked-first'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 2]);
    store.getState().setCurrentOutput(1);
    store.getState().addElement(makeElement('shape', 'reminted-linked-second'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([3, 3]);
  });

  it('keeps already-reminted legacy formats with unshared origins local', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Legacy', width: 1200, height: 675 });
    const remintedDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((out) => ({
        ...out,
        contentLinkGroup: undefined,
        children: out.children.map((child) => ({ ...child, originId: child.id })),
      })),
    } as DesignerDoc;
    store.getState().replaceDocTrusted(remintedDoc);

    store.getState().setCurrentOutput(0);
    store.getState().addElement(makeElement('shape', 'reminted-first'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 1]);
    store.getState().setCurrentOutput(1);
    store.getState().addElement(makeElement('shape', 'reminted-second'));
    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 2]);
  });

  it('skips frozen and independent siblings but seeds mutable linked siblings', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'source', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Frozen', width: 1200, height: 675 });
    store.getState().addOutput({ formatId: 'linkedin-post', name: 'Mutable', width: 1200, height: 627 });
    store.getState().addOutput(
      { formatId: 'ig-story', name: 'Independent', width: 1080, height: 1920 },
      { linkContent: false }
    );
    store.getState().setCurrentOutput(0);
    store.getState().setOutputFrozen(1, true);

    store.getState().addElement(makeElement('shape', 'linked-shape'));

    expect(store.getState().doc.outputs.map((out) => out.children.length)).toEqual([2, 1, 2, 1]);
    expect(store.getState().doc.outputs[2].children[1].originId)
      .toBe(store.getState().doc.outputs[0].children[1].originId);
    store.getState().undo();
    expect(store.getState().doc.outputs.every((out) => out.children.length === 1)).toBe(true);
  });

  it('attaches a detected focal point only to the independent output', async () => {
    focalMock.result = { x: 0.25, y: 0.75 };
    const store = storeWithLinkedAndIndependentOutputs();
    store.getState().setCurrentOutput(2);

    store.getState().addElement(makeElement('image', 'independent-image'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const outputs = store.getState().doc.outputs;
    expect(outputs[0].children).toHaveLength(1);
    expect(outputs[1].children).toHaveLength(1);
    expect(outputs[2].children).toHaveLength(2);
    expect(outputs[2].children[1].focalPoint).toEqual({ x: 0.25, y: 0.75 });
  });
});

describe('grouped output cloning', () => {
  it('clones every page from a non-first active source with target-local parents and one Undo', () => {
    const store = createDesignerStore(400, 400);
    const mixed = [
      { id: 'background', type: 'shape', x: 0, y: 0, width: 400, height: 400, fill: '#fff' },
      { id: 'logo', type: 'image', x: 20, y: 30, width: 80, height: 40, src: '/logo.png', crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
      { id: 'phone', type: 'image', x: 160, y: 80, width: 120, height: 220, src: '/phone.png' },
      { id: 'copy', type: 'text', x: 40, y: 320, width: 300, height: 50, text: 'Grouped copy' },
    ] as const;
    for (const el of mixed) {
      store.getState().addElement({
        rotation: 0, opacity: 1, locked: false, hidden: false, ...el,
      } as any);
    }
    store.getState().addPage();
    store.getState().addElement({
      id: 'page-two-copy', type: 'text', x: 30, y: 40, width: 240, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Page two',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Source', width: 600, height: 300 });
    store.getState().setCurrentOutput(1);
    store.getState().setCurrentPage(0);
    store.getState().groupSelection(store.getState().doc.outputs[1].children.map((el) => el.id));
    store.getState().setCurrentPage(1);
    store.getState().groupSelection(store.getState().doc.outputs[1].pages![0].children.map((el) => el.id));
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;

    expect(store.getState().addOutput(
      { formatId: 'ig-story', name: 'Independent carousel', width: 300, height: 500 },
      { linkContent: false }
    )).toBe(true);

    const cloned = store.getState().doc.outputs[2];
    expect(cloned.children.filter((el) => el.type !== 'group')).toHaveLength(4);
    expect(cloned.pages).toHaveLength(1);
    expect(cloned.pages![0].children.filter((el) => el.type !== 'group')).toHaveLength(1);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    for (const page of [cloned.children, cloned.pages![0].children]) {
      const ids = new Set(page.map((el) => el.id));
      expect(page.some((el) => el.type === 'group')).toBe(true);
      for (const el of page) {
        expect(el.originId).toBeUndefined();
        if (el.parentId) expect(ids.has(el.parentId)).toBe(true);
      }
    }
    const sourceLogo = before.outputs[1].children.find((el) => el.type === 'image' && el.src === '/logo.png');
    const clonedLogo = cloned.children.find((el) => el.type === 'image' && el.src === '/logo.png');
    expect(clonedLogo?.crop).toEqual(sourceLogo?.crop);

    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
  });

  it('keeps linked origins and move units intact with atomic grouping and cloning', () => {
    const store = createDesignerStore(400, 400);
    store.getState().addElement({
      id: 'logo', type: 'image', src: '/logo.png', x: 20, y: 30, width: 80, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'copy', type: 'text', text: 'Linked', x: 40, y: 120, width: 240, height: 50,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Source', width: 600, height: 300 });
    const beforeGroup = store.getState().doc;
    const groupHistory = store.getState().history.length;
    store.getState().groupSelection(beforeGroup.outputs[1].children.map((el) => el.id));
    const grouped = store.getState().doc;
    expect(store.getState().history).toHaveLength(groupHistory + 1);
    store.getState().undo();
    expect(store.getState().doc).toEqual(beforeGroup);
    store.getState().redo();
    expect(store.getState().doc).toEqual(grouped);

    const cloneHistory = store.getState().history.length;
    store.getState().addOutput({ formatId: 'ig-story', name: 'Linked clone', width: 300, height: 500 });
    const source = store.getState().doc.outputs[1];
    const cloned = store.getState().doc.outputs[2];
    const clonedIds = new Set(cloned.children.map((el) => el.id));
    expect(store.getState().history).toHaveLength(cloneHistory + 1);
    for (const sourceEl of source.children) {
      const copy = cloned.children.find((el) => el.originId === sourceEl.originId);
      expect(copy).toBeTruthy();
      expect(copy?.id).not.toBe(sourceEl.id);
      expect(copy?.groupId).toBe(sourceEl.groupId);
      if (copy?.parentId) expect(clonedIds.has(copy.parentId)).toBe(true);
    }
    store.getState().undo();
    expect(store.getState().doc).toEqual(grouped);
  });
});

describe('repeated output dimensions', () => {
  it('allows repeated presets and custom sizes with unique names and format-local geometry', () => {
    const store = createDesignerStore();
    const preset = { formatId: 'x-post', name: 'X Post', width: 1600, height: 900 };

    store.getState().addOutput(preset);
    store.getState().addOutput(preset);
    store.getState().addOutput({ formatId: 'custom', name: '500×500', width: 500, height: 500 });
    store.getState().addOutput({ formatId: 'custom', name: '500×500', width: 500, height: 500 });

    expect(store.getState().doc.outputs.map((out) => out.formatId)).toEqual([
      'ig-post', 'x-post', 'x-post', 'custom', 'custom',
    ]);
    expect(store.getState().doc.outputs.map((out) => out.name)).toEqual([
      'Instagram Post', 'X Post', 'X Post 2', '500×500', '500×500 2',
    ]);
    store.getState().resizeOutput(1, 600, 600);
    expect(store.getState().doc.outputs[1].width).toBe(600);
    expect(store.getState().doc.outputs[2].width).toBe(1600);
  });

  it('creates independent repeated formats and pages without propagating text edits, with one undo', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addPage();
    store.getState().addElement({
      id: 'page-two', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Second page',
    });
    const historyBefore = store.getState().history.length;

    store.getState().addOutput(
      { formatId: 'ig-post', name: 'Instagram Post', width: 1080, height: 1080 },
      { linkContent: false }
    );

    const outputs = store.getState().doc.outputs as any[];
    expect(outputs).toHaveLength(2);
    expect(outputs[1].children[0].id).not.toBe('headline');
    expect(outputs[1].children[0].originId).toBeUndefined();
    expect(outputs[1].pages[0].children[0].id).not.toBe('page-two');
    expect(outputs[1].pages[0].children[0].originId).toBeUndefined();
    expect(store.getState().history).toHaveLength(historyBefore + 1);

    store.getState().setCurrentOutput(0);
    store.getState().setCurrentPage(0);
    store.getState().updateElement('headline', { text: 'Only the source' });
    expect(store.getState().doc.outputs[1].children[0].text).toBe('Original');

    store.getState().undo();
    store.getState().undo();
    expect(store.getState().doc.outputs).toHaveLength(1);
    expect(store.getState().doc.outputs[0].children[0].text).toBe('Original');
  });

  it('keeps the default repeated format linked', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Original',
    });
    store.getState().addOutput({ formatId: 'ig-post', name: 'Instagram Post', width: 1080, height: 1080 });

    const outputs = store.getState().doc.outputs;
    expect(outputs[1].children[0].originId).toBe(outputs[0].children[0].originId);
    store.getState().setCurrentOutput(0);
    store.getState().updateElement('headline', { text: 'Shared' });
    expect(store.getState().doc.outputs[1].children[0].text).toBe('Shared');
  });

  it.each([true, false])('reflows stacks and contain media without changing the source (linked=%s)', (linkContent) => {
    const store = createDesignerStore();
    const shared = {
      x: 100, width: 400, rotation: 0, opacity: 1, locked: false, hidden: false,
    };
    store.getState().addElement({
      ...shared, id: 'headline', type: 'text', y: 100, height: 80, fontSize: 48, text: 'Headline',
    });
    store.getState().addElement({
      ...shared, id: 'subhead', type: 'text', y: 200, height: 80, fontSize: 24, text: 'Subhead',
    });
    store.getState().addElement({
      id: 'logo', type: 'image', src: 'https://example.com/logo.png', x: 650, y: 100,
      width: 240, height: 120, naturalWidth: 1600, naturalHeight: 900, fitMode: 'contain',
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, focalPoint: { x: 0.2, y: 0.7 },
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    const sourceGeometry = store.getState().doc.outputs[0].children.map((el) => ({
      id: el.id, x: el.x, y: el.y, width: el.width, height: el.height,
    }));

    store.getState().addOutput(
      { formatId: 'x-post', name: 'X Post', width: 1200, height: 675 },
      { linkContent }
    );

    const outputs = store.getState().doc.outputs;
    const headline = outputs[1].children.find((el) => el.text === 'Headline')!;
    const subhead = outputs[1].children.find((el) => el.text === 'Subhead')!;
    const logo = outputs[1].children.find((el) => el.type === 'image')!;
    expect(subhead.y).toBeGreaterThanOrEqual(headline.y + headline.height);
    expect(logo.width / logo.height).toBe(2);
    expect(logo.crop).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(logo.focalPoint).toEqual({ x: 0.2, y: 0.7 });
    expect(outputs[0].children.map((el) => ({
      id: el.id, x: el.x, y: el.y, width: el.width, height: el.height,
    }))).toEqual(sourceGeometry);
    expect(!!headline.originId).toBe(linkContent);
  });

  it('enforces MAX_OUTPUTS without changing the existing document', () => {
    const store = createDesignerStore();
    const doc = store.getState().doc;
    store.setState({
      doc: {
        ...doc,
        outputs: Array.from({ length: 30 }, (_, index) => ({
          ...doc.outputs[0], id: `out-${index}`, name: `Output ${index}`,
        })),
      },
    });

    store.getState().addOutput({ formatId: 'x-post', name: 'X Post', width: 1600, height: 900 });

    expect(store.getState().doc.outputs).toHaveLength(30);
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

describe('character references', () => {
  const references = [
    { fileId: 'file-1', src: 'https://example.com/character-1.png', name: 'One' },
    { fileId: 'file-2', src: 'https://example.com/character-2.png', name: 'Two' },
    { fileId: 'file-3', src: 'https://example.com/character-3.png', name: 'Three' },
    { fileId: 'file-4', src: 'https://example.com/character-4.png', name: 'Four' },
  ];
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };

  it('sets, changes, and removes references with one history entry per edit', () => {
    const store = videoStore();
    store.getState().markSaved();
    const depth = store.getState().history.length;

    store.getState().setCharacterReferences([references[0]]);
    expect(store.getState().doc.characterReferences).toEqual([references[0]]);
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().history).toHaveLength(depth + 1);

    store.getState().setCharacterReferences([references[1], references[0]]);
    expect(store.getState().doc.characterReferences).toEqual([references[1], references[0]]);
    expect(store.getState().history).toHaveLength(depth + 2);

    store.getState().setCharacterReferences([]);
    expect(store.getState().doc.characterReferences).toBeUndefined();
    expect(store.getState().history).toHaveLength(depth + 3);
    expect(store.getState().historyLabels.at(-1)).toBe('Edit character references');

    store.getState().undo();
    expect(store.getState().doc.characterReferences).toEqual([references[1], references[0]]);
    store.getState().undo();
    expect(store.getState().doc.characterReferences).toEqual([references[0]]);
    store.getState().redo();
    expect(store.getState().doc.characterReferences).toEqual([references[1], references[0]]);
  });

  it('ignores no-op writes and references in image mode', () => {
    const store = videoStore();
    const depth = store.getState().history.length;

    store.getState().setCharacterReferences([]);
    store.getState().setCharacterReferences(undefined);
    expect(store.getState().history).toHaveLength(depth);

    store.getState().setCharacterReferences([references[0]]);
    const doc = store.getState().doc;
    const changedDepth = store.getState().history.length;
    store.getState().setCharacterReferences([{ ...references[0] }]);
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().history).toHaveLength(changedDepth);

    const imageStore = createDesignerStore();
    const imageDoc = imageStore.getState().doc;
    imageStore.getState().setCharacterReferences([references[0]]);
    expect(imageStore.getState().doc).toBe(imageDoc);
    expect(imageStore.getState().isDirty).toBe(false);
    expect(imageStore.getState().history).toHaveLength(1);
  });

  it('caps references at three in their original order', () => {
    const store = videoStore();
    const depth = store.getState().history.length;

    store.getState().setCharacterReferences(references);

    expect(store.getState().doc.characterReferences).toEqual(references.slice(0, 3));
    expect(store.getState().history).toHaveLength(depth + 1);
  });

  it('normalizes long and blank media names to the document contract', () => {
    const store = videoStore();
    store.getState().setCharacterReferences([
      { ...references[0], name: `  ${'x'.repeat(205)}  ` },
      { ...references[1], name: '   ' },
    ]);

    expect(store.getState().doc.characterReferences?.[0].name).toHaveLength(200);
    expect(store.getState().doc.characterReferences?.[1]).toEqual({
      fileId: references[1].fileId,
      src: references[1].src,
    });
  });

  it('drops video-only references when switching to image mode', () => {
    const store = videoStore();
    store.getState().setCharacterReferences([references[0]]);

    store.getState().setMode('image');

    expect(store.getState().doc.mode).toBe('image');
    expect(store.getState().doc.characterReferences).toBeUndefined();
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

  it('addTrack refuses to grow past MAX_TRACKS', () => {
    const store = videoStore();
    for (let i = 0; i < MAX_TRACKS + 5; i++) store.getState().addTrack(0, 'video');
    expect(vo(store).tracks).toHaveLength(MAX_TRACKS);
  });
});

describe('moveClips — cross-track drop', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('moves a clip onto another same-type track as ONE history entry', () => {
    const store = videoStore();
    const source = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'video');
    const target = vo(store).tracks[1].id;
    store.getState().addClip(0, source, {
      id: 'c1', startMs: 0, endMs: 2000, src: 'v.mp4', x: 5, y: 6, width: 100, height: 80,
    } as never);
    const historyBefore = store.getState().history.length;

    const moved = store.getState().moveClips(0, [
      { trackId: source, clipId: 'c1', toTrackId: target, startMs: 4000, endMs: 6000 },
    ]);

    expect(moved).toBe(true);
    expect(store.getState().history.length).toBe(historyBefore + 1);
    expect(vo(store).tracks[0].clips).toHaveLength(0);
    const landed = vo(store).tracks[1].clips[0];
    expect(landed.id).toBe('c1');
    expect(landed.startMs).toBe(4000);
    expect(landed.endMs).toBe(6000);
    expect(landed.x).toBe(5); // non-timing props ride along

    store.getState().undo();
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    expect(vo(store).tracks[1].clips).toHaveLength(0);
  });

  it('creates the target track when newTrackType is given, still one entry', () => {
    const store = videoStore();
    const source = vo(store).tracks[0].id;
    store.getState().addClip(0, source, { id: 'c1', startMs: 1000, endMs: 3000 } as never);
    const historyBefore = store.getState().history.length;

    const moved = store.getState().moveClips(
      0,
      [{ trackId: source, clipId: 'c1', toTrackId: null, startMs: 1000, endMs: 3000 }],
      { newTrackType: 'video' }
    );

    expect(moved).toBe(true);
    expect(store.getState().history.length).toBe(historyBefore + 1);
    expect(vo(store).tracks).toHaveLength(2);
    expect(vo(store).tracks[1].type).toBe('video');
    expect(vo(store).tracks[1].clips[0].id).toBe('c1');
    expect(vo(store).tracks[0].clips).toHaveLength(0);

    store.getState().undo();
    expect(vo(store).tracks).toHaveLength(1);
    expect(vo(store).tracks[0].clips[0].id).toBe('c1');
  });

  it('moves a whole group across tracks in one step and keeps the selection on the clips', () => {
    const store = videoStore();
    const v1 = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'video');
    store.getState().addTrack(0, 'video');
    const [_, v2, v3] = vo(store).tracks.map((t) => t.id);
    store.getState().addClip(0, v1, { id: 'a', startMs: 0, endMs: 1000 } as never);
    store.getState().addClip(0, v2, { id: 'b', startMs: 0, endMs: 1000 } as never);
    store.getState().setSelectedClip({ outputIndex: 0, trackId: v1, clipId: 'a' });
    store.getState().setSelectedClips([
      { trackId: v1, clipId: 'a' },
      { trackId: v2, clipId: 'b' },
    ]);
    const historyBefore = store.getState().history.length;

    const moved = store.getState().moveClips(0, [
      { trackId: v1, clipId: 'a', toTrackId: v2, startMs: 2000, endMs: 3000 },
      { trackId: v2, clipId: 'b', toTrackId: v3, startMs: 2000, endMs: 3000 },
    ]);

    expect(moved).toBe(true);
    expect(store.getState().history.length).toBe(historyBefore + 1);
    expect(vo(store).tracks[0].clips).toHaveLength(0);
    expect(vo(store).tracks[1].clips.map((c) => c.id)).toEqual(['a']);
    expect(vo(store).tracks[2].clips.map((c) => c.id)).toEqual(['b']);
    expect(store.getState().selectedClips).toEqual([
      { trackId: v2, clipId: 'a' },
      { trackId: v3, clipId: 'b' },
    ]);
    expect(store.getState().selectedClip?.trackId).toBe(v2);
  });

  it('rejects illegal moves without moving anything or pushing history', () => {
    const store = videoStore();
    const source = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'audio');
    const audioId = vo(store).tracks[1].id;
    store.getState().addClip(0, source, { id: 'c1', startMs: 0, endMs: 2000 } as never);
    const historyBefore = store.getState().history.length;

    // Type mismatch.
    expect(
      store.getState().moveClips(0, [
        { trackId: source, clipId: 'c1', toTrackId: audioId, startMs: 0, endMs: 2000 },
      ])
    ).toBe(false);
    // Unknown clip.
    expect(
      store.getState().moveClips(0, [
        { trackId: source, clipId: 'gone', toTrackId: source, startMs: 0, endMs: 2000 },
      ])
    ).toBe(false);
    // Past the output duration.
    expect(
      store.getState().moveClips(0, [
        { trackId: source, clipId: 'c1', toTrackId: source, startMs: 0, endMs: vo(store).durationMs + 1 },
      ])
    ).toBe(false);

    expect(store.getState().history.length).toBe(historyBefore);
    expect(vo(store).tracks[0].clips.map((c) => c.id)).toEqual(['c1']);
    expect(vo(store).tracks[1].clips).toHaveLength(0);
  });

  it('refuses a drop onto a locked track', () => {
    const store = videoStore();
    const source = vo(store).tracks[0].id;
    store.getState().addTrack(0, 'video');
    const target = vo(store).tracks[1].id;
    store.getState().setTrackLocked(0, target, true);
    store.getState().addClip(0, source, { id: 'c1', startMs: 0, endMs: 2000 } as never);

    expect(
      store.getState().moveClips(0, [
        { trackId: source, clipId: 'c1', toTrackId: target, startMs: 0, endMs: 2000 },
      ])
    ).toBe(false);
    expect(vo(store).tracks[0].clips).toHaveLength(1);
  });

  it('refuses to create a track past MAX_TRACKS', () => {
    const store = videoStore();
    const source = vo(store).tracks[0].id;
    store.getState().addClip(0, source, { id: 'c1', startMs: 0, endMs: 2000 } as never);
    for (let i = 0; i < MAX_TRACKS + 5; i++) store.getState().addTrack(0, 'video');
    expect(vo(store).tracks).toHaveLength(MAX_TRACKS);

    expect(
      store.getState().moveClips(
        0,
        [{ trackId: source, clipId: 'c1', toTrackId: null, startMs: 0, endMs: 2000 }],
        { newTrackType: 'video' }
      )
    ).toBe(false);
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

  it('refuses to duplicate a clip on a locked track', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'src', startMs: 0, endMs: 2000 } as never);
    store.getState().setTrackLocked(0, trackId, true);
    const depth = store.getState().history.length;

    expect(store.getState().duplicateClip(0, trackId, 'src')).toBeNull();
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    expect(store.getState().history.length).toBe(depth);
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

  it('paste skips locked tracks and creates an unlocked compatible track only when needed', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 1000 } as never);
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    store.getState().copySelectedClips();
    store.getState().setTrackLocked(0, trackId, true);
    const depth = store.getState().history.length;

    store.getState().pasteClips(2000);
    expect(vo(store).tracks).toHaveLength(2);
    expect(vo(store).tracks[0].clips).toHaveLength(1);
    expect(vo(store).tracks[1].clips[0]).toMatchObject({ startMs: 2000, endMs: 3000 });
    expect(store.getState().history.length).toBe(depth + 1);
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

describe('multi-page outputs (doc v8)', () => {
  const addTextEl = (store: ReturnType<typeof createDesignerStore>, text: string) =>
    store.getState().addElement({
      id: '',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text,
    });

  it('adds, selects and removes pages, with history', () => {
    const store = createDesignerStore();
    const out = () => store.getState().doc.outputs[0] as any;

    store.getState().addPage();
    expect(out().pages).toHaveLength(1);
    expect(store.getState().currentPage).toBe(1);

    // Edits on page 2 stay local to the page — page 1 is untouched.
    addTextEl(store, 'Page two copy');
    expect(out().pages[0].children).toHaveLength(1);
    expect(out().children).toHaveLength(0);

    store.getState().setCurrentPage(0);
    addTextEl(store, 'Page one copy');
    expect(out().children).toHaveLength(1);

    store.getState().removePage(1);
    expect(out().pages).toBeUndefined();
    expect(store.getState().currentPage).toBe(0);

    store.getState().undo(); // undo removePage
    expect(out().pages).toHaveLength(1);
    expect(out().pages[0].children[0].text).toBe('Page two copy');
  });

  it('duplicatePage clones content with fresh ids', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Original');
    const sourceId = (store.getState().doc.outputs[0] as any).children[0].id;

    store.getState().duplicatePage(0);
    const out = store.getState().doc.outputs[0] as any;
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children[0].text).toBe('Original');
    expect(out.pages[0].children[0].id).not.toBe(sourceId);
    expect(store.getState().currentPage).toBe(1);
  });

  it('reorderPage moves page 1 into the extras', () => {
    const store = createDesignerStore();
    addTextEl(store, 'First');
    store.getState().addPage('Second');

    store.getState().reorderPage(0, 1);
    const out = store.getState().doc.outputs[0] as any;
    expect(out.children).toHaveLength(0);
    expect(out.pages[0].children[0].text).toBe('First');
    // The page pointer is index-stable: it followed nothing (page 2 was
    // viewed, and only the MOVED page would have been followed).
    expect(store.getState().currentPage).toBe(1);
  });

  it('renamePage only touches extras; page 1 keeps the output name', () => {
    const store = createDesignerStore();
    store.getState().addPage();
    store.getState().renamePage(1, 'Cover variant');
    expect((store.getState().doc.outputs[0] as any).pages[0].name).toBe('Cover variant');
    store.getState().renamePage(0, 'Nope');
    expect((store.getState().doc.outputs[0] as any).name).not.toBe('Nope');
  });

  it('clamps currentPage when outputs change under it', () => {
    const store = createDesignerStore();
    store.getState().addPage();
    store.getState().addPage();
    store.getState().setCurrentPage(2);
    expect(store.getState().currentPage).toBe(2);

    // Undo past the addPage history entries shrinks the page list — the page
    // pointer must clamp rather than address a ghost page.
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().currentPage).toBe(0);

    // Switching outputs always lands on page 1.
    store.getState().addOutput({ formatId: 'custom', name: 'B', width: 500, height: 500 });
    expect(store.getState().currentOutput).toBe(1);
    expect(store.getState().currentPage).toBe(0);
  });

  it('refuses pages in video mode', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addPage();
    expect((store.getState().doc.outputs[0] as any).pages).toBeUndefined();
    expect(store.getState().currentPage).toBe(0);
  });

  it('page-2 edits do not propagate across outputs (page-1-only linking)', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Linked');
    store.getState().addOutput({ formatId: 'custom', name: 'B', width: 500, height: 500 });
    // Back on output 0, add page 2 and edit there.
    store.getState().setCurrentOutput(0);
    store.getState().addPage();
    store.getState().setCurrentPage(1);
    store.getState().addElement({
      id: '',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
    });
    const outs = store.getState().doc.outputs as any[];
    // Page 2's new element did NOT seed a linked copy into output 1.
    expect(outs[1].children).toHaveLength(1); // only the page-1 seeded copy
    expect(outs[0].pages[0].children).toHaveLength(1);
  });
});

describe('multi-page resize, variants, and focal detection', () => {
  afterEach(() => {
    focalMock.result = null;
  });

  // Bottom-right anchored shape: reflow pins it to the new canvas corner, so
  // a stale (un-reflowed) element is trivially distinguishable.
  const addAnchoredShape = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().addElement({
      id: '',
      type: 'shape',
      shape: 'rect',
      x: 800,
      y: 880,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      anchor: 'bottom-right',
    });

  it('resizeOutput reflows pages 2+ onto the new canvas (not stale coordinates)', () => {
    const store = createDesignerStore(1080, 1080);
    addAnchoredShape(store); // page 1
    store.getState().addPage(); // lands on page 2
    addAnchoredShape(store); // same geometry on page 2

    store.getState().resizeOutput(0, 1080, 1920, 'custom-tall', 'Tall');

    const out = store.getState().doc.outputs[0] as any;
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    const p1 = out.children[0];
    const p2 = out.pages[0].children[0];
    // The page-2 element is NOT sitting on the old square canvas's (800, 880).
    expect(p2.y).not.toBe(880);
    // Both pages reflowed through the same anchor logic.
    expect(p2.x).toBe(p1.x);
    expect(p2.y).toBe(p1.y);
    expect(p2.width).toBe(p1.width);
    expect(p2.height).toBe(p1.height);
    // Bottom-right anchor: pinned near the new canvas corner (inset by the
    // canvas margin), not left at the old square's coordinates.
    expect(p1.x + p1.width).toBeGreaterThan(1080 * 0.9);
    expect(p1.y + p1.height).toBeGreaterThan(1920 * 0.9);
  });

  it('addOutput carries pages 2+ into the variant, reflowed with fresh ids and originIds', () => {
    const store = createDesignerStore(1080, 1080);
    addAnchoredShape(store);
    store.getState().addPage();
    addAnchoredShape(store);
    const srcOut = store.getState().doc.outputs[0] as any;
    const srcP2 = srcOut.pages[0].children[0];

    store.getState().addOutput({ formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 });

    const variant = store.getState().doc.outputs[1] as any;
    expect(variant.children).toHaveLength(1); // page 1 seeded, as before
    expect(variant.pages).toHaveLength(1); // page 2 came along
    expect(variant.pages[0].children).toHaveLength(1);
    const v1 = variant.children[0];
    const v2 = variant.pages[0].children[0];
    // Reflowed onto the tall canvas, exactly like the page-1 seed.
    expect(v2.y).not.toBe(880);
    expect(v2.x).toBe(v1.x);
    expect(v2.y).toBe(v1.y);
    // duplicatePageAt-style: fresh id AND fresh originId — page-2+ edits stay
    // local, so the clone must not read as linked to the source page.
    expect(v2.id).not.toBe(srcP2.id);
    expect(v2.originId).toBeTruthy();
    expect(v2.originId).not.toBe(srcP2.originId);
    // The source output is untouched.
    expect((store.getState().doc.outputs[0] as any).pages[0].children[0].id).toBe(srcP2.id);
  });

  it('image inserted on page 2 gets its focal point on THAT page, even after switching pages', async () => {
    focalMock.result = { x: 0.25, y: 0.75 };
    const store = createDesignerStore();
    store.getState().addPage(); // currentPage = 1

    store.getState().addElement({
      id: '', type: 'image', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
      src: 'https://example.com/page-two.png',
    });
    // The user switches back to page 1 before detection resolves — the write
    // must still land on page 2, where the element was inserted.
    store.getState().setCurrentPage(0);

    await new Promise((r) => setTimeout(r, 0));

    const out = store.getState().doc.outputs[0] as any;
    expect(out.children).toHaveLength(0);
    expect(out.pages[0].children).toHaveLength(1);
    expect(out.pages[0].children[0].focalPoint).toEqual({ x: 0.25, y: 0.75 });
  });

  it('page-1 image insert still propagates the focal point to linked copies on other outputs', async () => {
    focalMock.result = { x: 0.4, y: 0.6 };
    const store = createDesignerStore(1080, 1080);
    store.getState().addOutput({ formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 });
    store.getState().setCurrentOutput(0);

    store.getState().addElement({
      id: '', type: 'image', x: 0, y: 0, width: 200, height: 200,
      rotation: 0, opacity: 1, locked: false, hidden: false,
      src: 'https://example.com/hero.png',
    });

    await new Promise((r) => setTimeout(r, 0));

    const outs = store.getState().doc.outputs as any[];
    expect(outs[0].children[0].focalPoint).toEqual({ x: 0.4, y: 0.6 });
    expect(outs[1].children[0].focalPoint).toEqual({ x: 0.4, y: 0.6 });
  });
});

describe('video output variants (add-format for video mode)', () => {
  const videoStoreWithContent = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const vo = () => store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;
    const trackId = vo().tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'bg', startMs: 0, endMs: 8000, src: 'https://example.com/bg.mp4',
    } as never);
    store.getState().addTrack(0, 'text');
    const textTrack = vo().tracks.find((t) => t.type === 'text')!;
    store.getState().addClip(0, textTrack.id, {
      id: 'title', startMs: 500, endMs: 4000, text: 'Headline',
      x: 460, y: 900, width: 1000, height: 140, fontSize: 64,
    } as never);
    return store;
  };
  const out = (store: ReturnType<typeof createDesignerStore>, i: number) =>
    store.getState().doc.outputs[i] as import('./designer.store').VideoOutput;

  it('addOutput clones the timeline with fresh ids, shared originIds, unchanged timing', () => {
    const store = videoStoreWithContent();
    store.getState().addOutput({ formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 });

    const doc = store.getState().doc;
    expect(doc.outputs).toHaveLength(2);
    expect(store.getState().currentOutput).toBe(1);

    const v0 = out(store, 0);
    const v1 = out(store, 1);
    expect(v1).toMatchObject({ width: 1080, height: 1920, formatId: 'custom-tall', fps: v0.fps, durationMs: v0.durationMs });
    expect(v1.tracks).toHaveLength(v0.tracks.length);

    // Fresh ids; shared originId (backfilled on the source too).
    const srcTitle = v0.tracks.find((t) => t.type === 'text')!.clips[0];
    const copyTitle = v1.tracks.find((t) => t.type === 'text')!.clips[0];
    expect(copyTitle.id).not.toBe(srcTitle.id);
    expect(copyTitle.originId).toBeTruthy();
    expect(copyTitle.originId).toBe(srcTitle.originId);
    expect(copyTitle.startMs).toBe(srcTitle.startMs);
    expect(copyTitle.endMs).toBe(srcTitle.endMs);
    expect(copyTitle.text).toBe('Headline');
    // Geometry reflowed onto the tall canvas (not a verbatim copy).
    expect(copyTitle.y).not.toBe(srcTitle.y);

    // Undo removes the variant and restores the pointer.
    store.getState().undo();
    expect(store.getState().doc.outputs).toHaveLength(1);
  });

  it('can clone an independent video variant without propagating content edits', () => {
    const store = videoStoreWithContent();
    store.getState().addOutput(
      { formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 },
      { linkContent: false }
    );
    const v1 = out(store, 1);
    const sourceTitle = out(store, 0).tracks.find((track) => track.type === 'text')!.clips[0];
    const copiedTitle = v1.tracks.find((track) => track.type === 'text')!.clips[0];
    expect(copiedTitle.id).not.toBe(sourceTitle.id);
    expect(copiedTitle.originId).toBeUndefined();

    store.getState().updateClip(1, v1.tracks.find((track) => track.type === 'text')!.id, copiedTitle.id, {
      text: 'Independent',
    });
    expect(out(store, 0).tracks.find((track) => track.type === 'text')!.clips[0].text).toBe('Headline');
    expect(out(store, 1).tracks.find((track) => track.type === 'text')!.clips[0].text).toBe('Independent');

    store.getState().undo();
    store.getState().undo();
    expect(store.getState().doc.outputs).toHaveLength(1);
  });

  it('resizeOutput reflows a video output in place (ids preserved)', () => {
    const store = videoStoreWithContent();
    const before = out(store, 0);
    const titleId = before.tracks.find((t) => t.type === 'text')!.clips[0].id;

    store.getState().resizeOutput(0, 1080, 1920, 'custom-tall', 'Tall');

    const after = out(store, 0);
    expect(after).toMatchObject({ width: 1080, height: 1920, name: 'Tall' });
    const title = after.tracks.find((t) => t.type === 'text')!.clips[0];
    expect(title.id).toBe(titleId);
    expect(title.y).not.toBe(900);
    expect(after.durationMs).toBe(before.durationMs);
  });

  it('content edits propagate to the sibling variant clip; geometry stays local', () => {
    const store = videoStoreWithContent();
    store.getState().addOutput({ formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 });
    const v0 = out(store, 0);
    const v1 = out(store, 1);
    const t0 = v0.tracks.find((t) => t.type === 'text')!.clips[0];
    const t1 = v1.tracks.find((t) => t.type === 'text')!.clips[0];

    // Edit the VARIANT (current output after addOutput).
    store.getState().updateClip(1, v1.tracks.find((t) => t.type === 'text')!.id, t1.id, {
      text: 'Edited',
      x: 999,
    } as never);

    const after0 = out(store, 0).tracks.find((t) => t.type === 'text')!.clips[0];
    const after1 = out(store, 1).tracks.find((t) => t.type === 'text')!.clips[0];
    expect(after0.text).toBe('Edited'); // content propagated
    expect(after0.x).toBe(t0.x); // geometry stayed local
    expect(after1.x).toBe(999);
  });

  it('editFormatOnly keeps content edits local too', () => {
    const store = videoStoreWithContent();
    store.getState().addOutput({ formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 });
    const v1 = out(store, 1);
    const t1 = v1.tracks.find((t) => t.type === 'text')!.clips[0];

    store.getState().setEditFormatOnly(true);
    store.getState().updateClip(1, v1.tracks.find((t) => t.type === 'text')!.id, t1.id, {
      text: 'Local only',
    } as never);

    const after0 = out(store, 0).tracks.find((t) => t.type === 'text')!.clips[0];
    expect(after0.text).toBe('Headline');
  });
});

describe('updateClipSilent timing rules', () => {
  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;
  const seedClip = (store: ReturnType<typeof createDesignerStore>) => {
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'c1', startMs: 1000, endMs: 4000, src: 'https://example.com/v.mp4',
    } as never);
    return trackId;
  };

  it('non-timing updates land even when the clip is out of bounds (dead-inspector repro)', () => {
    const store = videoStore();
    const trackId = seedClip(store);
    // Shrink the output so the clip now ends past the duration.
    store.getState().setVideoDuration(0, 2000);

    // Every one of these used to be silently rejected.
    expect(store.getState().updateClipSilent(0, trackId, 'c1', { filters: ['grayscale'] })).toBe(true);
    expect(store.getState().updateClipSilent(0, trackId, 'c1', { opacity: 0.5 })).toBe(true);
    expect(store.getState().updateClipSilent(0, trackId, 'c1', { x: 40, width: 320 })).toBe(true);

    const clip = vo(store).tracks[0].clips[0];
    expect(clip.filters).toEqual(['grayscale']);
    expect(clip.opacity).toBe(0.5);
    expect(clip.x).toBe(40);
    expect(clip.width).toBe(320);
  });

  it('clamps out-of-range timing edits instead of rejecting them', () => {
    const store = videoStore();
    const trackId = seedClip(store);
    const durationMs = vo(store).durationMs;

    expect(
      store.getState().updateClipSilent(0, trackId, 'c1', { endMs: durationMs + 5000 })
    ).toBe(true);
    expect(vo(store).tracks[0].clips[0].endMs).toBe(durationMs);

    expect(store.getState().updateClipSilent(0, trackId, 'c1', { startMs: -500 })).toBe(true);
    expect(vo(store).tracks[0].clips[0].startMs).toBe(0);
  });

  it('clamps the untouched end of an out-of-bounds clip when timing is edited', () => {
    const store = videoStore();
    const trackId = seedClip(store);
    store.getState().setVideoDuration(0, 2000); // clip is now 1000–4000 in a 2000ms output

    // A drag of the start must not die on the clip's stale end.
    expect(store.getState().updateClipSilent(0, trackId, 'c1', { startMs: 500 })).toBe(true);
    const clip = vo(store).tracks[0].clips[0];
    expect(clip.startMs).toBe(500);
    expect(clip.endMs).toBe(2000);
  });

  it('still rejects a degenerate (zero-length) clip', () => {
    const store = videoStore();
    const trackId = seedClip(store);

    expect(
      store.getState().updateClipSilent(0, trackId, 'c1', { startMs: 3000, endMs: 3000 })
    ).toBe(false);
    expect(
      store.getState().updateClipSilent(0, trackId, 'c1', { startMs: 3500, endMs: 3000 })
    ).toBe(false);
    // …and no empty undo step is pushed by updateClip.
    const historyBefore = store.getState().history.length;
    store.getState().updateClip(0, trackId, 'c1', { startMs: 3000, endMs: 3000 });
    expect(store.getState().history.length).toBe(historyBefore);
  });

  it('still rejects updates for an unknown clip', () => {
    const store = videoStore();
    const trackId = seedClip(store);
    expect(store.getState().updateClipSilent(0, trackId, 'nope', { opacity: 0.5 })).toBe(false);
  });

  it('stamps v14 for stroke writes and insertion without re-versioning unrelated edits', () => {
    const store = videoStore();
    const trackId = seedClip(store);
    store.setState((state) => ({ doc: { ...state.doc, version: 10 } }));

    store.getState().updateClipSilent(0, trackId, 'c1', { fill: '#ffffff' });
    expect(store.getState().doc.version).toBe(10);
    store.getState().updateClipSilent(0, trackId, 'c1', {
      textStroke: { color: '#000000', width: 2 },
    });
    expect(store.getState().doc.version).toBe(14);

    store.setState((state) => ({ doc: { ...state.doc, version: 10 } }));
    store.getState().addClip(0, trackId, {
      id: 'stroked-insert', startMs: 4000, endMs: 5000,
      textStroke: { color: '#123456', width: 1 },
    } as never);
    expect(store.getState().doc.version).toBe(14);
  });
});

describe('persistent video clip groups', () => {
  const groupedStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, { id: 'a', startMs: 0, endMs: 2000, x: 10, y: 20 } as never);
    store.getState().addTrack(0, 'text');
    const textTrack = vo(store).tracks.find((track) => track.type === 'text')!;
    store.getState().addClip(0, textTrack.id, { id: 'b', startMs: 0, endMs: 2000, text: 'B' } as never);
    store.getState().setSelectedClips([
      { trackId, clipId: 'a' },
      { trackId: textTrack.id, clipId: 'b' },
    ]);
    return { store, trackId, textTrackId: textTrack.id };
  };
  const vo = (store: ReturnType<typeof createDesignerStore>) =>
    store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;

  it('groups, selects, and ungroups all members with one history step per command', () => {
    const { store, trackId, textTrackId } = groupedStore();
    const depth = store.getState().history.length;
    store.getState().groupSelection();
    const clips = vo(store).tracks.flatMap((track) => track.clips);
    const groupId = clips[0].groupId;
    expect(groupId).toBeTruthy();
    expect(clips.every((clip) => clip.groupId === groupId)).toBe(true);
    expect(store.getState().history.length).toBe(depth + 1);

    store.getState().setSelectedClips([]);
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    expect(store.getState().selectedClips).toEqual([
      { trackId, clipId: 'a' },
      { trackId: textTrackId, clipId: 'b' },
    ]);
    store.getState().toggleClipSelection(textTrackId, 'b');
    expect(store.getState().selectedClips).toEqual([]);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'a' });
    store.getState().ungroupSelection();
    expect(vo(store).tracks.flatMap((track) => track.clips).every((clip) => !clip.groupId)).toBe(true);
    expect(store.getState().history.length).toBe(depth + 2);
    store.getState().undo();
    expect(vo(store).tracks.flatMap((track) => track.clips).every((clip) => clip.groupId === groupId)).toBe(true);
  });

  it('remaps group ids on duplicate and consistently across a pasted batch', () => {
    const { store, trackId, textTrackId } = groupedStore();
    store.getState().groupSelection();
    const originalGroupId = vo(store).tracks[0].clips[0].groupId;
    const duplicateId = store.getState().duplicateClip(0, trackId, 'a')!;
    const duplicate = vo(store).tracks[0].clips.find((clip) => clip.id === duplicateId)!;
    expect(duplicate.groupId).toBeTruthy();
    expect(duplicate.groupId).not.toBe(originalGroupId);

    store.getState().setSelectedClips([
      { trackId, clipId: 'a' },
      { trackId: textTrackId, clipId: 'b' },
    ]);
    store.getState().copySelectedClips();
    store.getState().pasteClips(4000);
    const pasted = store.getState().selectedClips.map((ref) =>
      vo(store).tracks.find((track) => track.id === ref.trackId)!.clips.find((clip) => clip.id === ref.clipId)!
    );
    expect(pasted).toHaveLength(2);
    expect(pasted[0].groupId).toBe(pasted[1].groupId);
    expect(pasted[0].groupId).not.toBe(originalGroupId);
    expect(pasted[0].groupId).not.toBe(duplicate.groupId);
  });
});

describe('Magic Grab actions', () => {
  it('splits a static image into background and subject with one history entry', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'photo', type: 'image', x: 10, y: 20, width: 300, height: 200,
      rotation: 0, opacity: 1, locked: false, hidden: false, src: '/photo.png',
    });
    const original = store.getState().doc.outputs[0].children[0];
    const depth = store.getState().history.length;
    store.getState().applyMagicGrab('photo',
      { ...original, src: '/background.png' },
      { ...original, id: '', src: '/photo.png', maskSrc: '/subject-mask.png' }
    );

    const children = store.getState().doc.outputs[0].children;
    expect(children.map((child) => child.src)).toEqual(['/background.png', '/photo.png']);
    expect(store.getState().history.length).toBe(depth + 1);
    expect(store.getState().selectedIds).toHaveLength(1);
    expect(store.getState().selectedIds[0]).not.toBe('photo');
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children).toHaveLength(1);
    expect(store.getState().doc.outputs[0].children[0].src).toBe('/photo.png');
  });

  it('splits a still clip into background and subject tracks with one history entry', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'image');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'image')!;
    store.getState().addClip(0, track.id, {
      id: 'photo', startMs: 1000, endMs: 3000, src: '/photo.png',
      x: 10, y: 20, width: 300, height: 200,
    });
    const original = (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((item) => item.id === track.id)!.clips[0];
    const depth = store.getState().history.length;
    store.getState().applyMagicGrabClip(
      { outputIndex: 0, trackId: track.id, clipId: 'photo' },
      { ...original, src: '/background.png' },
      { ...original, id: '', maskSrc: '/subject-mask.png' }
    );

    const tracks = (store.getState().doc.outputs[0] as VideoOutput).tracks;
    expect(tracks).toHaveLength(3);
    expect(tracks.find((item) => item.id === track.id)?.clips[0].src).toBe('/background.png');
    const subjectTrackId = store.getState().selectedClip?.trackId;
    const subjectTrack = tracks.find((item) => item.id === subjectTrackId)!;
    expect(subjectTrack.type).toBe('image');
    expect(subjectTrack.clips[0]).toMatchObject({
      src: '/photo.png', startMs: 1000, endMs: 3000, maskSrc: '/subject-mask.png',
    });
    expect(store.getState().history.length).toBe(depth + 1);
    expect(subjectTrackId).not.toBe(track.id);
    store.getState().undo();
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks).toHaveLength(2);
  });
});

describe('preset preview isolation', () => {
  const text = {
    id: 'preview-text', type: 'text', text: 'Preview', x: 0, y: 0,
    width: 200, height: 40, fontSize: 32, rotation: 0, opacity: 1,
    locked: false, hidden: false,
  } as DesignerElement;

  it('keeps doc identity, dirty state and history unchanged through preview and clear', () => {
    const store = createDesignerStore();
    store.getState().addElement(text);
    store.getState().markSaved();
    const base = store.getState().doc;
    const depth = store.getState().history.length;

    store.getState().previewElements({ [text.id]: { fontSize: 72 } });
    expect(store.getState().doc).toBe(base);
    expect(store.getState().previewPatches).toEqual({ [text.id]: { fontSize: 72 } });
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().history).toHaveLength(depth);

    store.getState().clearElementPreview();
    expect(store.getState().doc).toBe(base);
    expect(store.getState().previewPatches).toBeNull();
    expect(store.getState().isDirty).toBe(false);
  });

  it('previews a photo frame and None without writing either into the document', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'photo', type: 'image', src: '/photo.png', x: 0, y: 0,
      width: 200, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    const base = store.getState().doc;
    store.getState().previewElements({
      photo: { mask: { type: 'shape', shape: 'ellipse' } },
    });
    expect(store.getState().doc).toBe(base);
    expect(store.getState().previewPatches?.photo.mask).toMatchObject({ shape: 'ellipse' });

    store.getState().previewElements({ photo: { mask: undefined } });
    expect(store.getState().doc).toBe(base);
    expect(store.getState().previewPatches?.photo.mask).toBeUndefined();
  });

  it('duplicates and records history from the base document during a preview', () => {
    const store = createDesignerStore();
    store.getState().addElement(text);
    const depth = store.getState().history.length;
    store.getState().previewElements({ [text.id]: { fontSize: 72 } });

    store.getState().duplicateElements([text.id]);
    const children = store.getState().doc.outputs[0].children;
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.fontSize)).toEqual([32, 32]);
    expect(store.getState().history).toHaveLength(depth + 1);
    expect(store.getState().history.at(-1)?.outputs[0].children.map((child) => child.fontSize))
      .toEqual([32, 32]);
    expect(store.getState().previewPatches).toBeNull();
  });

  it('groups, cuts, pastes and removes only base elements during a preview', () => {
    const grouped = createDesignerStore();
    grouped.getState().addElement(text);
    grouped.getState().previewElements({ [text.id]: { fontSize: 72 } });
    grouped.getState().groupSelection([text.id]);
    const groupedText = grouped.getState().doc.outputs[0].children.find(
      (element) => element.id === text.id
    );
    expect(groupedText).toMatchObject({ fontSize: 32 });
    expect(groupedText?.groupId).toBeTruthy();

    const pasted = createDesignerStore();
    pasted.getState().addElement(text);
    pasted.getState().setSelectedIds([text.id]);
    pasted.getState().previewElements({ [text.id]: { fontSize: 72 } });
    pasted.getState().cutSelection();
    expect(pasted.getState().clipboard[0].fontSize).toBe(32);
    expect(pasted.getState().doc.outputs[0].children).toHaveLength(0);
    pasted.getState().paste();
    expect(pasted.getState().doc.outputs[0].children[0].fontSize).toBe(32);

    const removed = createDesignerStore();
    removed.getState().addElement(text);
    removed.getState().previewElements({ [text.id]: { fontSize: 72 } });
    removed.getState().removeElements([text.id]);
    expect(removed.getState().doc.outputs[0].children).toHaveLength(0);
    expect(removed.getState().history.at(-1)?.outputs[0].children).toHaveLength(0);
    expect(removed.getState().previewPatches).toBeNull();
  });

  it('does not broadcast a collaboration document change for preview-only transitions', () => {
    const store = createDesignerStore();
    store.getState().addElement(text);
    const sent: DesignerDoc[] = [];
    const unsubscribe = subscribeToBaseDocument(store, (doc) => sent.push(doc));
    expect(sent).toHaveLength(1);

    store.getState().previewElements({ [text.id]: { fontSize: 72 } });
    store.getState().clearElementPreview();
    expect(sent).toHaveLength(1);

    store.getState().updateElement(text.id, { fill: '#abcdef' });
    expect(sent).toHaveLength(2);
    expect(sent[1].outputs[0].children[0]).toMatchObject({ fontSize: 32, fill: '#abcdef' });
    unsubscribe();
  });

  it('broadcasts only the final base document when a gesture ends', () => {
    const store = createDesignerStore();
    store.getState().addElement(text);
    const sent: DesignerDoc[] = [];
    const unsubscribe = subscribeToBaseDocument(store, (doc) => sent.push(doc));

    store.getState().beginGesture();
    store.getState().updateElementEphemeral(text.id, { x: 120 });
    expect(sent).toHaveLength(1);
    store.getState().previewElements({ [text.id]: { fontSize: 72 } });
    expect(sent).toHaveLength(1);

    store.getState().endGesture();
    expect(sent).toHaveLength(2);
    expect(sent[1].outputs[0].children[0]).toMatchObject({ x: 120, fontSize: 32 });
    unsubscribe();
  });

  it('applies async focal-point writes to the base document during a frame preview', async () => {
    focalMock.result = { x: 0.25, y: 0.75 };
    try {
      const store = createDesignerStore();
      store.getState().addElement({
        id: 'photo', type: 'image', src: '/photo.png', x: 0, y: 0,
        width: 200, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
      });
      store.getState().previewElements({
        photo: { mask: { type: 'shape', shape: 'ellipse' } },
      });
      await Promise.resolve();
      await Promise.resolve();

      const photo = store.getState().doc.outputs[0].children[0];
      expect(photo.focalPoint).toEqual({ x: 0.25, y: 0.75 });
      expect(photo.mask).toBeUndefined();
    } finally {
      focalMock.result = null;
    }
  });

  it('clears only the projection on undo and restores the real history document', () => {
    const store = createDesignerStore();
    store.getState().addElement(text);
    store.getState().updateElement(text.id, { fill: '#abcdef' });
    store.getState().pushHistory();
    store.getState().previewElements({ [text.id]: { fontSize: 72 } });

    store.getState().undo();
    expect(store.getState().doc.outputs[0].children[0].fontSize).toBe(32);
    expect(store.getState().doc.outputs[0].children[0].fill).toBeUndefined();
    expect(store.getState().previewPatches).toBeNull();
  });
});

describe('output freeze and carousel workflows', () => {
  const addTextEl = (store: ReturnType<typeof createDesignerStore>, text: string) =>
    store.getState().addElement({
      id: '', type: 'text', x: 0, y: 0, width: 100, height: 30,
      rotation: 0, opacity: 1, locked: false, hidden: false, text,
    });

  it('rejects frozen-source edits but lets mutable linked sources update without touching frozen targets', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Before');
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    store.getState().setOutputFrozen(1, true);
    const sourceId = store.getState().doc.outputs[0].children[0].id;

    store.getState().updateElement(sourceId, { text: 'After' });
    expect(store.getState().doc.outputs[0].children[0].text).toBe('After');
    expect(store.getState().doc.outputs[1].children[0].text).toBe('Before');

    store.getState().setOutputFrozen(0, true);
    store.getState().updateElementEphemeral(sourceId, { text: 'Rejected', x: 99 });
    store.getState().addPage();
    store.getState().resizeOutput(0, 500, 500);
    expect(store.getState().doc.outputs[0]).toMatchObject({ width: 1080, height: 1080 });
    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({ text: 'After', x: 0 });
    expect(store.getState().currentPage).toBe(0);

    store.getState().setCurrentOutput(1);
    expect(store.getState().currentOutput).toBe(1);
    store.getState().setOutputFrozen(0, false);
    store.getState().setCurrentOutput(0);
    store.getState().updateElement(sourceId, { text: 'Allowed' });
    expect(store.getState().doc.outputs[0].children[0].text).toBe('Allowed');
  });

  it('rejects frozen timeline edits and incoming linked clip edits', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const trackId = store.getState().doc.outputs[0].tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'clip', startMs: 0, endMs: 1000, text: 'Before',
    });
    store.getState().addOutput({ formatId: 'short', name: 'Short', width: 1080, height: 1920 });
    store.getState().setCurrentOutput(0);
    store.getState().setOutputFrozen(1, true);

    expect(store.getState().updateClipSilent(0, trackId, 'clip', { text: 'Source edit' })).toBe(true);
    expect(store.getState().doc.outputs[1].tracks[0].clips[0].text).toBe('Before');

    store.getState().setOutputFrozen(0, true);
    expect(store.getState().updateClipSilent(0, trackId, 'clip', { text: 'Rejected' })).toBe(false);
    store.getState().setVideoDuration(0, 5000);
    store.getState().resizeOutput(0, 720, 1280);
    expect(store.getState().doc.outputs[0]).toMatchObject({ durationMs: 10000, width: 1080, height: 1080 });
  });

  it('inserts after slides, promotes on first-slide delete, and survives save/reopen with one Undo per action', () => {
    const store = createDesignerStore();
    addTextEl(store, 'First');
    store.getState().addPage();
    addTextEl(store, 'Last');
    store.getState().setCurrentPage(0);

    let historyLength = store.getState().history.length;
    store.getState().addPage('Middle', 0);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(store.getState().currentPage).toBe(1);
    expect((store.getState().doc.outputs[0] as any).pages.map((page: any) => page.name)).toEqual(['Middle', undefined]);

    historyLength = store.getState().history.length;
    store.getState().duplicatePage(0);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect((store.getState().doc.outputs[0] as any).pages).toHaveLength(3);

    historyLength = store.getState().history.length;
    store.getState().removePage(0, true);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(store.getState().doc.outputs[0].children[0].text).toBe('First');
    expect(store.getState().doc.outputs[0].children[0].id).not.toBe('el-1');
    expect(store.getState().currentPage).toBe(0);

    store.getState().undo();
    expect(store.getState().doc.outputs[0].pages).toHaveLength(3);
    store.getState().redo();
    expect(store.getState().doc.outputs[0].pages).toHaveLength(2);

    const saved = structuredClone(store.getState().doc);
    store.getState().loadDesign(saved, 'carousel', 'Carousel');
    expect(store.getState().doc.outputs[0].pages).toHaveLength(2);

    store.getState().loadDesign({
      version: 8,
      mode: 'image',
      outputs: [{ id: 'old', formatId: 'ig-post', name: 'Old', width: 1080, height: 1080, background: '#fff', children: [] }],
    }, 'older', 'Older');
    expect(store.getState().doc.outputs[0].frozen).toBeUndefined();
  });
});


describe('freeze review regressions', () => {
  const addTextEl = (store: ReturnType<typeof createDesignerStore>, text: string) =>
    store.getState().addElement({
      id: '', type: 'text', x: 0, y: 0, width: 100, height: 30,
      rotation: 0, opacity: 1, locked: false, hidden: false, text,
    });

  it('undoes after adopting a key-reordered persisted clone', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setOutputFrozen(1, true);
    const sentDoc = store.getState().doc;
    const reordered = {
      ...sentDoc,
      outputs: sentDoc.outputs.map((output) =>
        Object.fromEntries(Object.entries(output).reverse()) as typeof output
      ),
    };

    expect(store.getState().adoptPersistedDoc(sentDoc, reordered)).toBe(true);
    expect(store.getState().setDoc(reordered)).toBe(true);
    store.getState().setCurrentOutput(0);
    addTextEl(store, 'Editable format');
    const editIndex = store.getState().historyIndex;

    store.getState().undo();

    expect(store.getState().historyIndex).toBe(editIndex - 1);
    expect(store.getState().doc.outputs[0].children).toHaveLength(0);
    expect(store.getState().doc.outputs[1].frozen).toBe(true);
  });

  it('does not change selection, history, or redo for blocked edits', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Keep me');
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().setSelectedIds([id]);
    store.getState().setOutputFrozen(0, true);
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().undo();
    const before = store.getState().doc;
    const selection = store.getState().selectedIds;
    const historyLength = store.getState().history.length;
    const historyIndex = store.getState().historyIndex;

    expect(store.getState().updateElementEphemeral(id, { x: 99 })).toBe(false);
    store.getState().removeElement(id);
    store.getState().updateElements([id], { text: 'Rejected' });
    store.getState().addPage();
    store.getState().paste();

    expect(store.getState().doc).toBe(before);
    expect(store.getState().selectedIds).toBe(selection);
    expect(store.getState().history).toHaveLength(historyLength);
    expect(store.getState().historyIndex).toBe(historyIndex);

    store.getState().redo();
    expect(store.getState().doc.outputs).toHaveLength(2);
  });

  it('seeds Add format from the active non-first frozen output, including its pages', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Primary');
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setEditFormatOnly(true);
    const secondId = store.getState().doc.outputs[1].children[0].id;
    store.getState().updateElement(secondId, { text: 'Secondary' });
    store.getState().pushHistory();
    store.getState().setEditFormatOnly(false);
    for (let page = 1; page < 5; page++) store.getState().addPage(`Slide ${page + 1}`);
    store.getState().setOutputFrozen(1, true);

    expect(store.getState().addOutput({ formatId: 'ig-story', name: 'Story', width: 1080, height: 1920 })).toBe(true);

    expect(store.getState().doc.outputs).toHaveLength(3);
    expect(store.getState().doc.outputs[2].children[0].text).toBe('Secondary');
    expect(store.getState().doc.outputs[0].children[0].text).toBe('Primary');
    expect(store.getState().doc.outputs[2].pages).toHaveLength(4);
  });

  it('rejects a linked Add format that would backfill a frozen source, but allows an independent copy', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Needs an origin');
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().updateElement(id, { originId: undefined });
    store.getState().setOutputFrozen(0, true);
    const historyLength = store.getState().history.length;

    expect(store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 })).toBe(false);
    expect(store.getState().doc.outputs).toHaveLength(1);
    expect(store.getState().history).toHaveLength(historyLength);

    expect(store.getState().addOutput(
      { formatId: 'x-post', name: 'X', width: 1200, height: 675 },
      { linkContent: false }
    )).toBe(true);
    expect(store.getState().doc.outputs).toHaveLength(2);
  });

  it('guards direct video output replacements used by Freeze Frame and captions', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const output = store.getState().doc.outputs[0] as import('./designer.store').VideoOutput;
    store.getState().setOutputFrozen(0, true);
    const before = store.getState().doc;
    const historyLength = store.getState().history.length;
    const updated = {
      ...output,
      tracks: [...output.tracks, { id: 'caption-track', type: 'caption' as const, clips: [] }],
    };

    expect(store.getState().commitVideoOutput(0, updated, 'Add captions')).toBe(false);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyLength);

    store.getState().setOutputFrozen(0, false);
    const unfrozenHistoryLength = store.getState().history.length;
    expect(store.getState().commitVideoOutput(0, updated, 'Add captions')).toBe(true);
    expect(store.getState().history).toHaveLength(unfrozenHistoryLength + 1);
    store.getState().undo();
    expect((store.getState().doc.outputs[0] as import('./designer.store').VideoOutput).tracks).toHaveLength(1);
  });

  it('rejects symbol-master edits referenced by a frozen output', () => {
    const store = createDesignerStore();
    addTextEl(store, 'Master');
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().setSelectedIds([id]);
    store.getState().createSymbol('Shared');
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setOutputFrozen(1, true);
    const before = store.getState().doc;
    const historyLength = store.getState().history.length;
    const definition = before.symbols![0];

    store.getState().updateSymbolDefinition(definition.id, [
      { ...definition.children[0], text: 'Changed' },
    ]);

    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyLength);
  });

  it('preserves promoted slide names and inherited backgrounds when deleting slide 1', () => {
    const store = createDesignerStore();
    const doc = store.getState().doc;
    store.getState().replaceDocTrusted({
      ...doc,
      outputs: [{
        ...doc.outputs[0],
        name: 'Original',
        bg: { type: 'color', color: '#ff0000' },
        pages: [
          { id: 'p2', name: 'Promoted', background: { type: 'color', color: '#0000ff' }, children: [] },
          { id: 'p3', name: 'Inherited', children: [] },
          { id: 'p4', name: 'Explicit', background: { type: 'color', color: '#00ff00' }, children: [] },
        ],
      }],
    });

    store.getState().removePage(0, true);

    const output = store.getState().doc.outputs[0];
    expect(output.name).toBe('Original');
    expect(output.bg).toEqual({ type: 'color', color: '#0000ff' });
    expect(output.pages?.[0].background).toEqual({ type: 'color', color: '#ff0000' });
    expect(output.pages?.[1].background).toEqual({ type: 'color', color: '#00ff00' });
  });

  it('pins the legacy output color on inheriting slides when slide 1 is deleted', () => {
    const store = createDesignerStore();
    const doc = store.getState().doc;
    store.getState().replaceDocTrusted({
      ...doc,
      outputs: [{
        ...doc.outputs[0], name: 'Legacy format', background: '#123456', bg: undefined,
        pages: [
          { id: 'p2', name: 'Promoted slide', children: [] },
          { id: 'p3', name: 'Inheriting slide', children: [] },
        ],
      }],
    });

    store.getState().removePage(0, true);

    const output = store.getState().doc.outputs[0];
    expect(output.name).toBe('Legacy format');
    expect(output.bg).toEqual({ type: 'color', color: '#123456' });
    expect(output.pages?.[0].background).toEqual({ type: 'color', color: '#123456' });
  });
});


describe('static clipboard paste placement', () => {
  const makeGroupedClipboard = () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().addElement({
      id: 'copy', name: 'Headline', type: 'text', text: 'Big headline', fontSize: 64,
      richText: [{ text: 'Big headline', fontWeight: 700, fontSize: 64 }],
      x: 100, y: 120, width: 600, height: 100, rotation: 12,
      opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'photo', name: 'Photo', type: 'image', src: 'https://cdn.example.test/photo.png',
      x: 140, y: 260, width: 360, height: 240, naturalWidth: 720, naturalHeight: 480,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, fitMode: 'contain',
      focalPoint: { x: 0.25, y: 0.75 }, rotation: 8,
      opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'badge', name: 'Badge', type: 'shape', shape: 'rect', fill: '#112233',
      x: 120, y: 540, width: 240, height: 80, rotation: 0,
      opacity: 1, locked: false, hidden: false,
    });
    store.getState().groupSelection(['copy', 'photo', 'badge']);
    const source = store.getState().doc.outputs[0] as DesignerOutput;
    const group = source.children.find((child) => child.type === 'group')!;
    store.getState().setSelectedIds([group.id]);
    store.getState().copySelection();
    return { store, source, group };
  };

  it('keeps same-format keyboard paste at +20/+20 with the complete remapped group', () => {
    const { store, source, group } = makeGroupedClipboard();
    const historyBefore = store.getState().history.length;

    store.getState().paste();

    const children = (store.getState().doc.outputs[0] as DesignerOutput).children;
    const pasted = children.filter((child) => !source.children.some((original) => original.id === child.id));
    expect(pasted.map((child) => child.type)).toEqual(source.children.map((child) => child.type));
    const sourceIds = new Set(source.children.map((child) => child.id));
    const sourceOrigins = new Set(source.children.map((child) => child.originId));
    const pastedGroup = pasted.find((child) => child.type === 'group')!;
    expect(pastedGroup.id).not.toBe(group.id);
    for (const child of pasted) {
      expect(sourceIds.has(child.id)).toBe(false);
      expect(sourceOrigins.has(child.originId)).toBe(false);
      const original = source.children[pasted.indexOf(child)];
      expect(child.x).toBe(original.x + 20);
      expect(child.y).toBe(original.y + 20);
      if (child.parentId) expect(child.parentId).toBe(pastedGroup.id);
    }
    expect(new Set(pasted.filter((child) => child.groupId).map((child) => child.groupId)).size).toBe(1);
    expect(pasted.find((child) => child.groupId)?.groupId).not.toBe(source.children.find((child) => child.groupId)?.groupId);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children).toHaveLength(source.children.length);
  });

  it('reflows a complete group and centers its bounds at the cross-format pointer', () => {
    const { store, source } = makeGroupedClipboard();
    const target = {
      ...source, id: 'target', name: 'Wide target', formatId: 'custom',
      width: 600, height: 400, children: [], pages: [], contentLinkGroup: 'target-link',
    } as DesignerOutput;
    store.getState().replaceDocTrusted({ ...store.getState().doc, outputs: [source, target] });
    store.getState().pushHistory('Fixture outputs');
    store.getState().setCurrentOutput(1);
    const sourceJson = JSON.stringify(source);
    const clipboardJson = JSON.stringify(store.getState().clipboard);
    const historyBefore = store.getState().history.length;

    store.getState().paste({ x: 300, y: 200 });

    const pasted = (store.getState().doc.outputs[1] as DesignerOutput).children;
    expect(pasted.map((child) => child.type)).toEqual(source.children.map((child) => child.type));
    const leaves = pasted.filter((child) => child.type !== 'group');
    const left = Math.min(...leaves.map((child) => child.x));
    const right = Math.max(...leaves.map((child) => child.x + child.width));
    const top = Math.min(...leaves.map((child) => child.y));
    const bottom = Math.max(...leaves.map((child) => child.y + child.height));
    expect((left + right) / 2).toBeCloseTo(300, 5);
    expect((top + bottom) / 2).toBeCloseTo(200, 5);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(600);
    expect(bottom).toBeLessThanOrEqual(400);
    expect(pasted.find((child) => child.id === 'copy')).toBeUndefined();

    const text = pasted.find((child) => child.type === 'text')!;
    const sourceText = source.children.find((child) => child.type === 'text')!;
    expect(text.fontSize).toBe(29);
    expect(text.richText?.map((run) => ({ text: run.text, fontWeight: run.fontWeight, fontSize: run.fontSize }))).toEqual([
      { text: 'Big headline', fontWeight: 700, fontSize: 29 },
    ]);
    expect(text.rotation).toBe(12);
    const image = pasted.find((child) => child.type === 'image')!;
    const sourceImage = source.children.find((child) => child.type === 'image')!;
    expect(image.crop).toEqual(sourceImage.crop);
    expect(image.focalPoint).toEqual(sourceImage.focalPoint);
    expect(image.rotation).toBe(8);
    expect(image.width! / image.height!).toBeCloseTo(sourceImage.width / sourceImage.height, 1);

    const pastedGroup = pasted.find((child) => child.type === 'group')!;
    const sourceGroup = source.children.find((child) => child.type === 'group')!;
    expect(pastedGroup.id).not.toBe(sourceGroup.id);
    for (const child of leaves) expect(child.parentId).toBe(pastedGroup.id);
    expect(new Set(leaves.map((child) => child.groupId)).size).toBe(1);
    expect(leaves[0].groupId).not.toBe(source.children.find((child) => child.groupId)?.groupId);
    expect(JSON.stringify(source)).toBe(sourceJson);
    expect(JSON.stringify(store.getState().clipboard)).toBe(clipboardJson);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc.outputs[1].children).toHaveLength(0);
  });

  it('clamps a pointer-pasted batch onto the target without moving members independently', () => {
    const store = createDesignerStore(600, 400);
    store.getState().addElement({
      id: 'wide', type: 'shape', shape: 'rect', x: 100, y: 100, width: 200, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'small', type: 'shape', shape: 'rect', x: 150, y: 150, width: 150, height: 50,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().groupSelection(['wide', 'small']);
    const group = store.getState().doc.outputs[0].children.find((child) => child.type === 'group')!;
    store.getState().setSelectedIds([group.id]);
    store.getState().copySelection();
    const originalIds = new Set(store.getState().doc.outputs[0].children.map((child) => child.id));

    store.getState().paste({ x: 590, y: 390 });

    const leaves = store.getState().doc.outputs[0].children
      .filter((child) => child.type === 'shape' && !originalIds.has(child.id));
    expect(Math.min(...leaves.map((child) => child.x))).toBe(400);
    expect(Math.max(...leaves.map((child) => child.x + child.width))).toBe(600);
    expect(Math.min(...leaves.map((child) => child.y))).toBe(300);
    expect(Math.max(...leaves.map((child) => child.y + child.height))).toBe(400);
    expect(leaves[1].x - leaves[0].x).toBe(50);
    expect(leaves[1].y - leaves[0].y).toBe(50);
  });

  it('centers an oversized batch instead of clamping it', () => {
    const store = createDesignerStore(600, 400);
    store.getState().addElement({
      id: 'oversized', type: 'shape', shape: 'rect', x: -50, y: 100, width: 700, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().groupSelection(['oversized']);
    const group = store.getState().doc.outputs[0].children.find((child) => child.type === 'group')!;
    store.getState().setSelectedIds([group.id]);
    store.getState().copySelection();

    store.getState().paste({ x: 300, y: 200 });

    const pasted = store.getState().doc.outputs[0].children.find((child) => child.id === 'oversized');
    const copy = store.getState().doc.outputs[0].children.find((child) => child.type === 'shape' && child.id !== 'oversized')!;
    expect(pasted).toBeTruthy();
    expect(copy.x).toBe(-50);
    expect(copy.x + copy.width).toBe(650);
    expect(copy.y).toBe(150);
  });

  it('cuts a complete selected group and restores it with one Undo', () => {
    const store = createDesignerStore(600, 400);
    for (const id of ['first', 'second']) {
      store.getState().addElement({
        id, type: 'shape', shape: 'rect', x: 100, y: 100, width: 100, height: 100,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      });
    }
    store.getState().groupSelection(['first', 'second']);
    const before = store.getState().doc.outputs[0].children;
    const group = before.find((child) => child.type === 'group')!;
    store.getState().setSelectedIds([group.id]);

    store.getState().cutSelection();

    expect(store.getState().doc.outputs[0].children).toHaveLength(0);
    expect(store.getState().clipboard.map((child) => child.type)).toEqual(['group', 'shape', 'shape']);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children.map((child) => child.type)).toEqual(['group', 'shape', 'shape']);
  });
});

describe('frozen output read-only clipboard actions', () => {
  it('copies clips and keyframes while still rejecting paste mutations', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const trackId = store.getState().doc.outputs[0].tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'clip', startMs: 0, endMs: 1000,
      keyframes: [{ tMs: 0, props: { x: 25 } }],
    } as never);
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'clip' });
    store.getState().setOutputFrozen(0, true);
    const before = store.getState().doc;

    store.getState().copySelectedClips();
    store.getState().copyClipKeyframes(0, trackId, 'clip');
    expect(store.getState().clipClipboard).toHaveLength(1);
    expect(store.getState().clipClipboard[0].clip.id).toBe('clip');
    expect(store.getState().keyframeClipboard).toHaveLength(1);

    store.getState().pasteClips(2000);
    store.getState().pasteClipKeyframes();
    expect(store.getState().doc).toBe(before);
  });
});


describe('exact page and output duplication', () => {
  const staticStore = () => {
    const store = createDesignerStore();
    const source: DesignerOutput = {
      id: 'source', formatId: 'ig-post', name: 'Instagram Post', width: 400, height: 300,
      background: '#ffffff', contentLinkGroup: 'linked-set', typeBudget: 1.2,
      bg: { type: 'color', color: '#fafafa' }, guides: { x: [20], y: [30] },
      children: [
        { id: 'folder', type: 'group', x: 0, y: 0, width: 0, height: 0, rotation: 0, opacity: 1, locked: false, hidden: false, originId: 'origin-folder', groupId: 'move-unit' },
        { id: 'title', parentId: 'folder', groupId: 'move-unit', originId: 'origin-title', type: 'text', text: 'Exact copy', richText: [{ text: 'Exact copy', fontWeight: 700 }], fontSize: 32, x: 20, y: 30, width: 240, height: 50, rotation: 4, opacity: 0.9, locked: false, hidden: false },
        { id: 'photo', originId: 'origin-photo', type: 'image', src: '/photo.png', fileId: 'file-1', crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, fitMode: 'cover', x: 30, y: 100, width: 120, height: 90, rotation: 0, opacity: 1, locked: false, hidden: false },
      ],
      pages: [{
        id: 'page-two', name: 'Details', background: { type: 'color', color: '#000000' },
        children: [
          { id: 'page-folder', type: 'group', x: 0, y: 0, width: 0, height: 0, rotation: 0, opacity: 1, locked: false, hidden: false, originId: 'page-origin-folder', groupId: 'page-move-unit' },
          { id: 'page-title', parentId: 'page-folder', groupId: 'page-move-unit', originId: 'page-origin-title', type: 'text', text: 'Page two', x: 10, y: 20, width: 180, height: 40, rotation: 0, opacity: 1, locked: false, hidden: false },
        ],
      }],
    };
    store.getState().replaceDocTrusted({ ...store.getState().doc, outputs: [source] });
    store.getState().pushHistory('Fixture');
    return { store, source };
  };

  it('duplicates every static page exactly with linked page-one origins and remapped local ids', () => {
    const { store, source } = staticStore();
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;

    expect(store.getState().duplicateOutput(0, { linkContent: true })).toBe(true);

    const after = store.getState().doc;
    const copy = after.outputs[1] as DesignerOutput;
    expect(after.outputs).toHaveLength(2);
    expect(after.outputs[0]).toEqual(source);
    expect(copy).toMatchObject({
      formatId: source.formatId, name: 'Instagram Post 2', width: 400, height: 300,
      background: '#ffffff', contentLinkGroup: 'linked-set', typeBudget: 1.2,
      bg: { type: 'color', color: '#fafafa' }, guides: { x: [20], y: [30] },
    });
    expect(copy.id).not.toBe(source.id);
    expect(copy.pages?.[0].id).not.toBe('page-two');
    expect(copy.pages?.[0]).toMatchObject({ name: 'Details', background: { type: 'color', color: '#000000' } });
    expect(store.getState().currentOutput).toBe(1);
    expect(store.getState().currentPage).toBe(0);
    expect(store.getState().history).toHaveLength(historyBefore + 1);

    const sourceTitle = source.children.find((element) => element.id === 'title')!;
    const copyTitle = copy.children.find((element) => element.type === 'text')!;
    const copyFolder = copy.children.find((element) => element.type === 'group')!;
    const copyPhoto = copy.children.find((element) => element.type === 'image')!;
    expect(copyTitle.originId).toBe(sourceTitle.originId);
    expect(copyTitle.parentId).toBe(copyFolder.id);
    expect(copyTitle.groupId).toBe(copyFolder.groupId);
    expect(copyTitle.groupId).not.toBe('move-unit');
    expect(copyTitle.richText).toEqual(sourceTitle.richText);
    expect(copyPhoto.crop).toEqual(source.children.find((element) => element.id === 'photo')!.crop);
    expect(copyPhoto.fileId).toBe('file-1');
    const copiedPageTitle = copy.pages![0].children.find((element) => element.type === 'text')!;
    const copiedPageFolder = copy.pages![0].children.find((element) => element.type === 'group')!;
    expect(copiedPageTitle.originId).toBeTruthy();
    expect(copiedPageTitle.originId).not.toBe('page-origin-title');
    expect(copiedPageTitle.parentId).toBe(copiedPageFolder.id);
    expect(copiedPageTitle.groupId).toBe(copiedPageFolder.groupId);

    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
    store.getState().redo();
    expect(store.getState().doc).toEqual(after);
  });

  it('makes independent static duplicates without sharing origins or link groups', () => {
    const { store, source } = staticStore();
    const historyBefore = store.getState().history.length;

    expect(store.getState().duplicateOutput(0, { linkContent: false })).toBe(true);

    const copy = store.getState().doc.outputs[1] as DesignerOutput;
    expect(copy.contentLinkGroup).toBeTruthy();
    expect(copy.contentLinkGroup).not.toBe(source.contentLinkGroup);
    for (const element of [...copy.children, ...copy.pages![0].children]) {
      expect(element.originId).toBeUndefined();
    }
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().setCurrentOutput(0);
    store.getState().updateElement('title', { text: 'Source only' });
    expect(copy.children.find((element) => element.type === 'text')?.text).toBe('Exact copy');
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().doc.outputs).toHaveLength(1);
  });

  it.each([true, false])('duplicates video tracks, timing, styles, markers and groups without reflow (linked=%s)', (linkContent) => {
    const store = createDesignerStore();
    const source = {
      id: 'video-source', formatId: 'custom', name: 'Video', width: 640, height: 360,
      fps: 30, durationMs: 9000, bg: { type: 'color' as const, color: '#123456' },
      markers: [{ id: 'marker', tMs: 1500, name: 'Beat' }],
      tracks: [
        { id: 'video-track', type: 'video' as const, name: 'Footage', gain: 0.8, locked: true, clips: [{
          id: 'video-clip', originId: 'video-origin', groupId: 'shared-move', startMs: 200, endMs: 8000,
          trimInMs: 100, trimOutMs: 7800, src: '/movie.mp4', fileId: 'movie-file', x: 11, y: 22,
          width: 333, height: 144, rotation: 7, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          fitMode: 'cover' as const, speed: 1.5, speedCurve: [{ atMs: 0, speed: 1 }, { atMs: 1000, speed: 2 }],
          keyframes: [{ tMs: 400, props: { x: 50, opacity: 0.5 } }],
          transitionOut: { type: 'fade' as const, durationMs: 300 }, filters: ['brightness(1.1)'],
        }] },
        { id: 'text-track', type: 'text' as const, hidden: true, clips: [{
          id: 'text-clip', originId: 'text-origin', groupId: 'shared-move', startMs: 500, endMs: 4000,
          text: 'Headline', fontSize: 64, fontWeight: 700, textStroke: { color: '#ffffff', width: 2 },
          x: 460, y: 90, width: 100, height: 140,
        }] },
      ],
    };
    store.getState().replaceDocTrusted({ ...store.getState().doc, mode: 'video', outputs: [source] });
    store.getState().pushHistory('Fixture');
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;

    expect(store.getState().duplicateOutput(0, { linkContent })).toBe(true);

    const after = store.getState().doc;
    const copy = after.outputs[1] as import('./designer.store').VideoOutput;
    expect(copy).toMatchObject({ name: 'Video 2', width: 640, height: 360, fps: 30, durationMs: 9000, bg: { type: 'color', color: '#123456' } });
    expect(copy.id).not.toBe(source.id);
    expect(copy.markers).toHaveLength(1);
    expect(copy.markers![0]).toMatchObject({ tMs: 1500, name: 'Beat' });
    expect(copy.markers![0].id).not.toBe('marker');
    expect(copy.tracks.map((track) => track.id)).not.toEqual(source.tracks.map((track) => track.id));
    expect(copy.tracks[0]).toMatchObject({ type: 'video', name: 'Footage', gain: 0.8, locked: true });
    expect(copy.tracks[1]).toMatchObject({ type: 'text', hidden: true });
    const copiedVideo = copy.tracks[0].clips[0];
    expect(copiedVideo).toEqual({
      ...source.tracks[0].clips[0], id: copiedVideo.id, groupId: copiedVideo.groupId,
      originId: linkContent ? copiedVideo.originId : undefined,
    });
    expect(copiedVideo.id).not.toBe('video-clip');
    expect(copiedVideo.groupId).not.toBe('shared-move');
    expect(copiedVideo.groupId).toBe(copy.tracks[1].clips[0].groupId);
    expect(copiedVideo.keyframes).toEqual(source.tracks[0].clips[0].keyframes);
    expect(copiedVideo.speedCurve).toEqual(source.tracks[0].clips[0].speedCurve);
    expect(copy.tracks[1].clips[0]).toEqual({
      ...source.tracks[1].clips[0], id: copy.tracks[1].clips[0].id, groupId: copy.tracks[1].clips[0].groupId,
      originId: linkContent ? copy.tracks[1].clips[0].originId : undefined,
    });
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
    store.getState().redo();
    expect(store.getState().doc).toEqual(after);
  });

  it('allows independent copies of frozen sources but rejects linked origin backfill and output overflow', () => {
    const { store, source } = staticStore();
    const frozen = { ...source, frozen: true, children: source.children.map((element) => ({ ...element, originId: undefined })) };
    store.getState().replaceDocTrusted({ ...store.getState().doc, outputs: [frozen] });
    store.getState().pushHistory('Frozen fixture');
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;

    expect(store.getState().duplicateOutput(0)).toBe(false);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyBefore);
    expect(store.getState().duplicateOutput(0, { linkContent: false })).toBe(true);
    expect(store.getState().doc.outputs[0].frozen).toBe(true);
    expect(store.getState().doc.outputs[1].frozen).toBeUndefined();

    const fullOutputs = Array.from({ length: MAX_OUTPUTS }, (_, index) => ({ ...source, id: `output-${index}` }));
    store.getState().replaceDocTrusted({ ...store.getState().doc, outputs: fullOutputs });
    store.getState().pushHistory('Full fixture');
    const fullDoc = store.getState().doc;
    const fullHistory = store.getState().history.length;
    expect(store.getState().duplicateOutput(0)).toBe(false);
    expect(store.getState().doc).toBe(fullDoc);
    expect(store.getState().history).toHaveLength(fullHistory);
  });

  it('remaps page folder and move-unit ids with one Undo and respects freeze and page caps', () => {
    const store = createDesignerStore();
    for (const id of ['first', 'second']) {
      store.getState().addElement({ id, type: 'shape', shape: 'rect', x: 10, y: 20, width: 100, height: 80, rotation: 0, opacity: 1, locked: false, hidden: false });
    }
    store.getState().groupSelection(['first', 'second']);
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;

    store.getState().duplicatePage(0);

    const duplicatedDoc = store.getState().doc;
    const output = duplicatedDoc.outputs[0] as DesignerOutput;
    const copy = output.pages![0].children;
    const sourceGroup = before.outputs[0].children.find((element) => element.type === 'group')!;
    const sourceLeaf = before.outputs[0].children.find((element) => element.id === 'first')!;
    const sourceOrigins = new Set(before.outputs[0].children.map((element) => element.originId));
    const copyGroup = copy.find((element) => element.type === 'group')!;
    const copyLeaf = copy.find((element) => element.type !== 'group')!;
    expect(copyGroup.id).not.toBe(sourceGroup.id);
    expect(copyLeaf.groupId).not.toBe(sourceLeaf.groupId);
    for (const element of copy.filter((item) => item.type !== 'group')) {
      expect(element.parentId).toBe(copyGroup.id);
      expect(element.groupId).toBe(copyLeaf.groupId);
      expect(sourceOrigins.has(element.originId)).toBe(false);
    }
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
    store.getState().redo();
    expect(store.getState().doc).toEqual(duplicatedDoc);

    store.getState().setOutputFrozen(0, true);
    const frozenDoc = store.getState().doc;
    store.getState().duplicatePage(0);
    expect(store.getState().doc).toBe(frozenDoc);
    store.getState().setOutputFrozen(0, false);
    while ((store.getState().doc.outputs[0] as DesignerOutput).pages!.length < MAX_PAGES_PER_OUTPUT - 1) {
      store.getState().addPage();
    }
    const fullDoc = store.getState().doc;
    store.getState().duplicatePage(0);
    expect(store.getState().doc).toBe(fullDoc);
  });
});


describe('duplication review regressions', () => {
  it.each(['image', 'video'] as const)('inserts a %s duplicate immediately after a non-last source', (mode) => {
    const store = createDesignerStore();
    if (mode === 'video') store.getState().setMode('video');
    const original = store.getState().doc.outputs[0];
    const outputs = [
      { ...original, id: 'before', name: 'Before' },
      { ...original, id: 'source', name: 'Source' },
      { ...original, id: 'after', name: 'After' },
    ];
    store.getState().replaceDocTrusted({ ...store.getState().doc, outputs });

    expect(store.getState().duplicateOutput(1)).toBe(true);

    expect(store.getState().doc.outputs.map((output) => output.name)).toEqual([
      'Before', 'Source', 'Source 2', 'After',
    ]);
    expect(store.getState().currentOutput).toBe(2);
  });

  it('backfills and shares origins when duplicating a legacy static source', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'legacy-title', type: 'text', text: 'Original', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().updateElement('legacy-title', { originId: undefined });

    expect(store.getState().duplicateOutput(0)).toBe(true);

    const outputs = store.getState().doc.outputs;
    const sourceTitle = outputs[0].children[0];
    const copyTitle = outputs[1].children[0];
    expect(sourceTitle.originId).toBeTruthy();
    expect(copyTitle.originId).toBe(sourceTitle.originId);
    store.getState().setCurrentOutput(0);
    store.getState().updateElement('legacy-title', { text: 'Shared edit' });
    expect(store.getState().doc.outputs[1].children[0].text).toBe('Shared edit');
  });

  it('backfills and shares origins when duplicating a legacy video source', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'text');
    const track = store.getState().doc.outputs[0].tracks.find((item) => item.type === 'text')!;
    store.getState().addClip(0, track.id, {
      id: 'legacy-title', startMs: 0, endMs: 1000, text: 'Original',
    } as never);
    const withoutOrigins = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((output) => ({
        ...output,
        tracks: output.tracks.map((item) => ({
          ...item,
          clips: item.clips.map((clip) => ({ ...clip, originId: undefined })),
        })),
      })),
    };
    store.getState().replaceDocTrusted(withoutOrigins);

    expect(store.getState().duplicateOutput(0)).toBe(true);

    const outputs = store.getState().doc.outputs;
    const sourceTrack = outputs[0].tracks.find((item) => item.type === 'text')!;
    const copyTrack = outputs[1].tracks.find((item) => item.type === 'text')!;
    expect(sourceTrack.clips[0].originId).toBeTruthy();
    expect(copyTrack.clips[0].originId).toBe(sourceTrack.clips[0].originId);
    store.getState().updateClip(1, copyTrack.id, copyTrack.clips[0].id, { text: 'Shared edit' });
    expect(store.getState().doc.outputs[0].tracks.find((item) => item.type === 'text')!.clips[0].text)
      .toBe('Shared edit');
  });

  it('stamps a duplicated legacy linked source and its eligible siblings with one link group', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'legacy-title', type: 'text', text: 'Original', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'Legacy sibling', width: 1200, height: 675 });
    store.getState().replaceDocTrusted({
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((output) => ({ ...output, contentLinkGroup: undefined })),
    });
    store.getState().setCurrentOutput(0);

    expect(store.getState().duplicateOutput(0)).toBe(true);

    const outputs = store.getState().doc.outputs;
    const linkGroup = outputs[0].contentLinkGroup;
    expect(linkGroup).toBeTruthy();
    expect(outputs.map((output) => output.contentLinkGroup)).toEqual([linkGroup, linkGroup, linkGroup]);
  });

  it('rejects frozen video origin backfill and creates an unfrozen independent copy', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const track = store.getState().doc.outputs[0].tracks[0];
    store.getState().addClip(0, track.id, {
      id: 'clip', startMs: 0, endMs: 1000, src: '/movie.mp4',
    } as never);
    const source = store.getState().doc.outputs[0];
    store.getState().replaceDocTrusted({
      ...store.getState().doc,
      outputs: [{
        ...source,
        frozen: true,
        tracks: source.tracks.map((item) => ({
          ...item,
          clips: item.clips.map((clip) => ({ ...clip, originId: undefined })),
        })),
      }],
    });
    store.getState().pushHistory('Frozen video fixture');
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;

    expect(store.getState().duplicateOutput(0)).toBe(false);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyBefore);
    expect(store.getState().duplicateOutput(0, { linkContent: false })).toBe(true);
    expect(store.getState().doc.outputs[0].frozen).toBe(true);
    expect(store.getState().doc.outputs[1].frozen).toBeUndefined();
  });
});
