import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { createDesignAutosave, type PreviewUpload } from './designer-autosave';

/**
 * Covers the designer autosave pipeline (`designer-autosave.ts`) the way
 * designer.tsx wires it: the debounced-doc effect calls `save(doc)`, and
 * manual Save (Cmd+S) goes through `ensureCreated()`. fetch is mocked exactly
 * like designer.store.spec.ts — a Response-shaped object per endpoint.
 */

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

const addText = (store: ReturnType<typeof createDesignerStore>, text: string) => {
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
};

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, method: string, url: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) => u === url && (init as RequestInit | undefined)?.method === method
  );

describe('createDesignAutosave', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the design once on the first edit, then PUTs later edits', async () => {
    const store = createDesignerStore(1080, 1080);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') return Promise.resolve(okJson({ id: 'design-1' }));
      return Promise.resolve(okJson({}));
    });
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'file-1' } as PreviewUpload);
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    addText(store, 'First edit');
    const dirtyDoc = store.getState().doc;
    autosave.save(dirtyDoc);
    await flush();

    const posts = callsTo(fetchMock, 'POST', '/media/designs');
    expect(posts).toHaveLength(1);
    const payload = JSON.parse((posts[0][1] as RequestInit).body as string);
    expect(payload).toMatchObject({
      name: 'Untitled Design',
      width: 1080,
      height: 1080,
      previewFileId: 'file-1',
    });
    expect(payload.doc).toEqual(dirtyDoc);
    expect(store.getState().designId).toBe('design-1');
    // No edit landed mid-flight, so the create marks the doc saved.
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().isSaving).toBe(false);

    addText(store, 'Second edit');
    const nextDoc = store.getState().doc;
    autosave.save(nextDoc);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-1');
    expect(puts).toHaveLength(1);
    const putPayload = JSON.parse((puts[0][1] as RequestInit).body as string);
    expect(putPayload.doc).toEqual(nextDoc);
    expect(putPayload.previewFileId).toBe('file-1');
    expect(store.getState().isDirty).toBe(false);
  });

  it('shares one in-flight create across concurrent saves (no duplicate POST)', async () => {
    const store = createDesignerStore();
    let resolvePost: (res: Response) => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'Edit');
    // The debounced effect can re-fire while the POST is in flight, and manual
    // Save joins via ensureCreated — all three must share one create.
    autosave.save(store.getState().doc);
    autosave.save(store.getState().doc);
    const manualSave = autosave.ensureCreated();
    expect(autosave.createInFlight()).not.toBeNull();
    // Let the create reach the POST (the preview await is a microtask) so the
    // deferred resolver is captured before we settle it.
    await flush();

    resolvePost(okJson({ id: 'design-9' }));
    await expect(manualSave).resolves.toBe('design-9');
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    expect(store.getState().designId).toBe('design-9');
    expect(autosave.createInFlight()).toBeNull();
  });

  it('does not create for a pristine blank doc', async () => {
    const store = createDesignerStore();
    const fetchMock = vi.fn();
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(store.getState().doc);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().isSaving).toBe(false);
    expect(store.getState().designId).toBeNull();
  });

  it('still creates when the preview upload fails', async () => {
    const store = createDesignerStore(800, 600);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') return Promise.resolve(okJson({ id: 'design-2' }));
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockRejectedValue(new Error('thumbnail blew up')),
    });

    addText(store, 'Edit');
    autosave.save(store.getState().doc);
    await flush();

    const posts = callsTo(fetchMock, 'POST', '/media/designs');
    expect(posts).toHaveLength(1);
    const payload = JSON.parse((posts[0][1] as RequestInit).body as string);
    expect(payload.previewFileId).toBeUndefined();
    expect(payload.previewDataUrl).toBeUndefined();
    expect(store.getState().designId).toBe('design-2');
    expect(store.getState().isDirty).toBe(false);
  });

  it('clears the in-flight guard after a failed create so a later save retries', async () => {
    const store = createDesignerStore();
    let attempts = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') {
        attempts += 1;
        return attempts === 1
          ? Promise.resolve({ ok: false, json: async () => ({}) } as Response)
          : Promise.resolve(okJson({ id: 'design-3' }));
      }
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'Edit');
    autosave.save(store.getState().doc);
    await flush();

    expect(store.getState().designId).toBeNull();
    expect(store.getState().isSaving).toBe(false);
    expect(store.getState().isDirty).toBe(true);
    expect(autosave.createInFlight()).toBeNull();

    autosave.save(store.getState().doc);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(2);
    expect(store.getState().designId).toBe('design-3');
    expect(store.getState().isDirty).toBe(false);
  });

  it('never clobbers an id another flow set while the create was in flight', async () => {
    const store = createDesignerStore();
    let resolvePost: (res: Response) => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'Edit');
    autosave.save(store.getState().doc);
    await flush();
    // Template apply POSTs its own design up front and lands its id first.
    store.getState().setDesignId('template-design');
    resolvePost(okJson({ id: 'autosave-design' }));
    await flush();

    expect(store.getState().designId).toBe('template-design');
  });

  it('stays dirty when an edit lands while the create is in flight, then PUTs it', async () => {
    const store = createDesignerStore();
    let resolvePost: (res: Response) => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'First edit');
    autosave.save(store.getState().doc);
    await flush();
    // An edit lands mid-POST: the create must NOT mark the doc saved.
    addText(store, 'Second edit');
    resolvePost(okJson({ id: 'design-4' }));
    await flush();

    expect(store.getState().designId).toBe('design-4');
    expect(store.getState().isDirty).toBe(true);

    autosave.save(store.getState().doc);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-4')).toHaveLength(1);
    expect(store.getState().isDirty).toBe(false);
  });
});
