import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { createAutosaveSubscription, createDesignAutosave, type PreviewUpload } from './designer-autosave';

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
    // The PUT carries the current name too — a rename must survive autosave,
    // not just the doc.
    expect(putPayload.name).toBe('Untitled Design');
    expect(putPayload.previewFileId).toBe('file-1');
    expect(store.getState().isDirty).toBe(false);
  });

  it('persists a rename through the autosave PUT (name read at send time)', async () => {
    const store = createDesignerStore(1080, 1080);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') return Promise.resolve(okJson({ id: 'design-1' }));
      return Promise.resolve(okJson({}));
    });
    const uploadPreview = vi.fn().mockResolvedValue({} as PreviewUpload);
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    addText(store, 'First edit');
    autosave.save(store.getState().doc);
    await flush();
    expect(store.getState().designId).toBe('design-1');
    expect(store.getState().isDirty).toBe(false);

    // A rename changes no doc — the PUT must still carry the new name.
    store.getState().setDesignName('Spring campaign');
    autosave.save(store.getState().doc);
    await flush();

    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-1');
    expect(puts).toHaveLength(1);
    const putPayload = JSON.parse((puts[0][1] as RequestInit).body as string);
    expect(putPayload.name).toBe('Spring campaign');
    expect(store.getState().isDirty).toBe(false);
  });

  it('stays dirty when a rename lands while the PUT is in flight', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-5');
    let resolvePut: (res: Response) => void = () => {};
    const fetchMock = vi.fn(() =>
      new Promise<Response>((resolve) => {
        resolvePut = resolve;
      })
    );
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'Edit');
    autosave.save(store.getState().doc);
    await flush();
    // Rename mid-PUT: the in-flight request carries the old name, so the new
    // one is still unsaved work when it resolves.
    store.getState().setDesignName('Renamed');
    resolvePut(okJson({}));
    await flush();

    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().isSaving).toBe(false);

    // The next autosave cycle persists the rename.
    autosave.save(store.getState().doc);
    await flush();
    resolvePut(okJson({}));
    await flush();
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-5');
    expect(puts).toHaveLength(2);
    const lastPut = JSON.parse((puts[1][1] as RequestInit).body as string);
    expect(lastPut.name).toBe('Renamed');
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

  it('does not create for a name-only change on a blank doc', async () => {
    const store = createDesignerStore();
    const fetchMock = vi.fn();
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    // A rename marks the store dirty, so without the blank gate this save
    // would POST a design whose canvas was never touched.
    store.getState().setDesignName('Renamed but blank');
    autosave.save(store.getState().doc);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().isSaving).toBe(false);
    expect(store.getState().designId).toBeNull();
  });

  it('creates on the first real content change', async () => {
    const store = createDesignerStore();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') return Promise.resolve(okJson({ id: 'design-content' }));
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    store.getState().setDesignName('Renamed but blank');
    autosave.save(store.getState().doc);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    addText(store, 'First real content');
    autosave.save(store.getState().doc);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    expect(store.getState().designId).toBe('design-content');
  });

  it('still PUTs a blank doc that has an existing designId', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-existing');
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    // The user deleted every element of a saved design — the blank result
    // must persist, so the blank gate only applies before a designId exists.
    store.getState().setDoc(store.getState().doc);
    autosave.save(store.getState().doc);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(0);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-existing')).toHaveLength(1);
    expect(store.getState().isDirty).toBe(false);
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

describe('createAutosaveSubscription', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not recurse when the create lands its id mid-save (APP-18)', async () => {
    const store = createDesignerStore(1080, 1080);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') return Promise.resolve(okJson({ id: 'design-r1' }));
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });
    const unsubscribe = createAutosaveSubscription(store, autosave, 5);

    // First edit schedules the debounced save; the save POSTs, the id lands
    // in the store, and the subscriber re-fires synchronously from inside
    // save()'s setSaving(). With a stale prev that notification re-enters
    // save() until the stack blows — the fixed subscriber advances prev
    // first, so the id transition is observed exactly once.
    addText(store, 'First edit');
    await new Promise((resolve) => setTimeout(resolve, 60));
    unsubscribe();

    expect(store.getState().designId).toBe('design-r1');
    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-r1')).toHaveLength(1);
    expect(store.getState().isDirty).toBe(false);
  });

  it('stops scheduling after unsubscribe', async () => {
    const store = createDesignerStore(1080, 1080);
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });
    const unsubscribe = createAutosaveSubscription(store, autosave, 5);

    addText(store, 'First edit');
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
