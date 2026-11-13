import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { createAutosaveSubscription, createDesignAutosave, type PreviewUpload } from './designer-autosave';

/**
 * Covers the designer autosave pipeline (`designer-autosave.ts`) the way
 * designer.tsx wires it: the debounced-doc effect calls `save(doc)`, and
 * manual Save (Cmd+S) goes through `ensureCreated()`. fetch is mocked exactly
 * like designer.store.spec.ts — a Response-shaped object per endpoint.
 */

const flush = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

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

const addVideo = (store: ReturnType<typeof createDesignerStore>) => {
  store.getState().setMode('video');
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput];
  if (!('tracks' in output)) throw new Error('Expected a video output');
  const track = output.tracks.find((t) => t.type === 'video');
  if (!track) throw new Error('Expected a video track');
  state.addClip(state.currentOutput, track.id, {
    id: '',
    startMs: 0,
    endMs: 5000,
    src: '/uploads/org-1/video.mp4',
    fileId: 'source-video',
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

  it('never uploads or sends client snapshots for video create and update saves', async () => {
    const store = createDesignerStore(1080, 1920);
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs') return Promise.resolve(okJson({ id: 'video-design' }));
      return Promise.resolve(okJson({}));
    });
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'black-frame' });
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    addVideo(store);
    autosave.save(store.getState().doc);
    await flush();
    store.getState().setDoc(store.getState().doc);
    autosave.save(store.getState().doc);
    await flush();

    const post = callsTo(fetchMock, 'POST', '/media/designs')[0];
    const put = callsTo(fetchMock, 'PUT', '/media/designs/video-design')[0];
    for (const [, init] of [post, put]) {
      const payload = JSON.parse((init as RequestInit).body as string);
      expect(payload.previewFileId).toBeUndefined();
      expect(payload.previewDataUrl).toBeUndefined();
    }
    expect(uploadPreview).not.toHaveBeenCalled();
  });

  it('persists a rename through the autosave PUT', async () => {
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
    expect(store.getState().isSaving).toBe(true);

    resolvePost(okJson({ id: 'design-9' }));
    await expect(manualSave).resolves.toBe('design-9');
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    expect(store.getState().designId).toBe('design-9');
    expect(autosave.createInFlight()).toBeNull();
    expect(store.getState().isSaving).toBe(false);
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
    // The same queued operation follows the create with the newer doc.
    expect(store.getState().isDirty).toBe(false);

    autosave.save(store.getState().doc);
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-4')).toHaveLength(1);
    expect(store.getState().isDirty).toBe(false);
  });

  it('does not POST a queued intermediate doc again after a slow first create', async () => {
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

    addText(store, 'D1');
    autosave.save(store.getState().doc);
    await flush();
    addText(store, 'D2');
    autosave.save(store.getState().doc);
    addText(store, 'D3');
    const latestDoc = store.getState().doc;
    resolvePost(okJson({ id: 'design-slow-create' }));
    await flush();

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-slow-create');
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string).doc).toEqual(latestDoc);
    expect(store.getState().designId).toBe('design-slow-create');
    expect(store.getState().isDirty).toBe(false);
  });

  it('adopts a first-create id across silent edits without a second POST', async () => {
    const store = createDesignerStore();
    addText(store, 'Committed base');
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().updateElementsSilent([id], { x: 10 });
    const firstSilentDoc = store.getState().doc;
    expect(store.getState().history).not.toContain(firstSilentDoc);
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

    autosave.save(firstSilentDoc);
    await flush();
    store.getState().updateElementsSilent([id], { x: 20 });
    const latestDoc = store.getState().doc;
    resolvePost(okJson({ id: 'design-silent-create' }));
    await flush();
    autosave.save(latestDoc);
    await flush();

    expect(store.getState().designId).toBe('design-silent-create');
    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-silent-create');
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string).doc).toEqual(latestDoc);
    expect(store.getState().isDirty).toBe(false);
  });

  it('does not adopt or share a create across reset design sessions', async () => {
    const store = createDesignerStore();
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    }));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'Old session');
    autosave.save(store.getState().doc);
    await flush();
    store.getState().reset();
    addText(store, 'New session');
    const newCreate = autosave.ensureCreated();
    await flush();
    expect(resolvers).toHaveLength(2);

    resolvers[0](okJson({ id: 'design-old-session' }));
    await flush();
    expect(store.getState().designId).toBeNull();
    resolvers[1](okJson({ id: 'design-new-session' }));
    await expect(newCreate).resolves.toBe('design-new-session');
    await flush();
    expect(store.getState().designId).toBe('design-new-session');
    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(2);
  });
});

describe('createDesignAutosave retry bound', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Store with an existing design and one dirty edit, ready to PUT. */
  const dirtyStore = () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-x');
    addText(store, 'Edit');
    return store;
  };

  it('stops retrying after 5 consecutive failures and marks retries paused', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    const fetchMock = vi.fn().mockRejectedValue(new Error('backend down'));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({ previewFileId: 'file-1' } as PreviewUpload),
    });

    autosave.save(store.getState().doc);
    // Initial attempt + backoff retries (2s, 4s, 8s, 16s) = 5 total, then pause.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(5);
    expect(store.getState().saveFailed).toBe(true);
    expect(store.getState().saveRetryPaused).toBe(true);
    expect(store.getState().isDirty).toBe(true);

    // No storm: advancing far past the 30s backoff cap schedules nothing more.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(5);
  });

  it('does not re-upload the preview on retries of the same unchanged doc', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    const fetchMock = vi.fn().mockRejectedValue(new Error('backend down'));
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'file-1' } as PreviewUpload);
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(5);
    // One upload for the first attempt; all four retries reused it…
    expect(uploadPreview).toHaveBeenCalledTimes(1);
    // …and every PUT carried that preview id.
    for (const [, init] of callsTo(fetchMock, 'PUT', '/media/designs/design-x')) {
      expect(JSON.parse((init as RequestInit).body as string).previewFileId).toBe('file-1');
    }
  });

  it('treats a non-OK PUT as a failed write (retry + pill), not as a silent save', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({} as PreviewUpload),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().saveFailed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x').length).toBeGreaterThan(1);
  });

  it('re-arms on the next real edit after pausing, and ignores non-edits', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    const fetchMock = vi.fn().mockRejectedValue(new Error('backend down'));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({} as PreviewUpload),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getState().saveRetryPaused).toBe(true);
    const callsAtPause = callsTo(fetchMock, 'PUT', '/media/designs/design-x').length;

    // The debounced effect re-firing for the SAME doc (e.g. an unrelated store
    // write) must not re-arm — only a real edit does.
    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(callsAtPause);
    expect(store.getState().saveRetryPaused).toBe(true);

    // A real edit re-arms: the autosave PUTs again (and fails fresh, so the
    // backoff cycle restarts rather than staying paused).
    addText(store, 'New edit after pause');
    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveRetryPaused).toBe(false);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x').length).toBeGreaterThan(callsAtPause);
  });

  it('recovers cleanly: a successful retry clears failed + paused and resets the backoff', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    let down = true;
    const fetchMock = vi.fn(() =>
      down ? Promise.reject(new Error('backend down')) : Promise.resolve(okJson({}))
    );
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({} as PreviewUpload),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().saveFailed).toBe(true);

    // Backend recovers before the next retry.
    down = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(store.getState().saveFailed).toBe(false);
    expect(store.getState().saveRetryPaused).toBe(false);
    expect(store.getState().isDirty).toBe(false);

    // The failure counter reset: a fresh outage gets the full 5 attempts again.
    // (The first outage made 3 PUTs: initial, the failed 2s retry, the
    // successful 4s retry.)
    down = true;
    addText(store, 'Second outage edit');
    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(3 + 5);
    expect(store.getState().saveRetryPaused).toBe(true);
  });

  it('bounds create-path retries the same way and reuses the create preview', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response));
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'file-c' } as PreviewUpload);
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    addText(store, 'Edit');
    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(5);
    expect(uploadPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().saveRetryPaused).toBe(true);
    expect(store.getState().designId).toBeNull();
  });

  it('clears the failure pill when a retry lands on a now-blank, never-created design', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({} as PreviewUpload),
    });

    addText(store, 'Edit');
    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().saveFailed).toBe(true);

    // The user wipes the canvas before the retry fires: the doc is blank and
    // the design was never created, so there is nothing server-side to be out
    // of sync with — the pill must clear, not stick on "retrying" forever.
    const ids = store
      .getState()
      .doc.outputs[0].children.map((c: { id: string }) => c.id);
    store.getState().removeElements(ids);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getState().saveFailed).toBe(false);
    expect(store.getState().saveRetryPaused).toBe(false);
    // Exactly one failed POST — the blank gate swallowed every retry.
    expect(callsTo(fetchMock, 'POST', '/media/designs')).toHaveLength(1);
  });

  it('manual Save bypasses retry pause and reports a real persisted write', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    let down = true;
    const fetchMock = vi.fn(() =>
      down ? Promise.reject(new Error('backend down')) : Promise.resolve(okJson({}))
    );
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({ previewFileId: 'file-1' } as PreviewUpload),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getState().saveRetryPaused).toBe(true);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(5);

    down = false;
    await expect(autosave.saveNow(store.getState().doc)).resolves.toBe('persisted');
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(6);
    expect(store.getState().saveRetryPaused).toBe(false);
    expect(store.getState().isDirty).toBe(false);
  });

  it('reschedules autosave retry after an immediate manual Save also fails', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    let down = true;
    const fetchMock = vi.fn(() =>
      down ? Promise.reject(new Error('backend down')) : Promise.resolve(okJson({}))
    );
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    await expect(autosave.saveNow(store.getState().doc)).resolves.toBe('failed');
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(2);

    down = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(3);
    expect(store.getState().saveFailed).toBe(false);
    expect(store.getState().isDirty).toBe(false);
  });

  it('does not cancel one design retry when another design saves successfully', async () => {
    vi.useFakeTimers();
    const store = dirtyStore();
    let designXDown = true;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/media/designs/design-x' && designXDown) {
        designXDown = false;
        return Promise.reject(new Error('design-x down'));
      }
      return Promise.resolve(okJson({}));
    });
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(1);

    const other = createDesignerStore();
    store.getState().loadDesign(other.getState().doc, 'design-other', 'Other');
    addText(store, 'Other design edit');
    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().isDirty).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(2);
  });

  it('reports failed and superseded manual writes instead of treating them as saved', async () => {
    const store = dirtyStore();
    const fetchMock = vi.fn().mockRejectedValue(new Error('backend down'));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    await expect(autosave.saveNow(store.getState().doc)).resolves.toBe('failed');
    expect(store.getState().isDirty).toBe(true);

    const staleDoc = store.getState().doc;
    addText(store, 'Newer edit');
    await expect(autosave.saveNow(staleDoc)).resolves.toBe('skipped');
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-x')).toHaveLength(1);
    expect(store.getState().isDirty).toBe(true);
  });

  it('reports a successful manual write superseded while in flight as persisted', async () => {
    const store = dirtyStore();
    let resolvePut!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolvePut = resolve;
    }));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    const manual = autosave.saveNow(store.getState().doc);
    await flush();
    addText(store, 'Edit while manual Save is in flight');
    const latestDoc = store.getState().doc;
    resolvePut(okJson({}));

    await expect(manual).resolves.toBe('persisted');
    expect(store.getState().doc).toBe(latestDoc);
    expect(store.getState().isDirty).toBe(true);
  });

  it('adopts materialized assets from the save response without adding history', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-inline');
    store.getState().addElement({
      id: 'inline-image',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: 'data:image/png;base64,aGVsbG8=',
    });
    const historyDepth = store.getState().history.length;
    const persistedDoc = JSON.parse(JSON.stringify(store.getState().doc));
    persistedDoc.outputs[0].children[0].src = '/uploads/org-1/inline.png';
    persistedDoc.outputs[0].children[0].fileId = 'file-inline';
    const fetchMock = vi.fn(() => Promise.resolve(okJson({ id: 'design-inline', doc: persistedDoc })));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(store.getState().doc);
    await flush();

    const image = store.getState().doc.outputs[0].children[0];
    expect(image).toMatchObject({ src: '/uploads/org-1/inline.png', fileId: 'file-inline' });
    expect(store.getState().history).toHaveLength(historyDepth);
    expect(store.getState().isDirty).toBe(false);
  });

  it('does not overwrite an edit that lands while materialized save is in flight', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-inline');
    store.getState().addElement({
      id: 'inline-image',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: 'data:image/png;base64,aGVsbG8=',
    });
    const sentDoc = store.getState().doc;
    const persistedDoc = JSON.parse(JSON.stringify(sentDoc));
    persistedDoc.outputs[0].children[0].src = '/uploads/org-1/inline.png';
    let resolvePut: (res: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolvePut = resolve;
    }));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(sentDoc);
    await flush();
    addText(store, 'Newer edit');
    const editedDoc = store.getState().doc;
    resolvePut(okJson({ id: 'design-inline', doc: persistedDoc }));
    await flush();

    expect(store.getState().doc).toBe(editedDoc);
    expect(store.getState().doc.outputs[0].children).toHaveLength(2);
    expect(store.getState().doc.outputs[0].children[0].src).toBe('data:image/png;base64,aGVsbG8=');
    expect(store.getState().isDirty).toBe(true);
  });
});

describe('createDesignAutosave scheduling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defers automatic previews to idle and promotes the same task for manual Save', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-idle');
    addText(store, 'Edit');
    const cancelIdle = vi.fn();
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 17));
    vi.stubGlobal('cancelIdleCallback', cancelIdle);
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'preview-idle' });
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    autosave.save(store.getState().doc);
    await Promise.resolve();
    await Promise.resolve();
    expect(uploadPreview).not.toHaveBeenCalled();

    await autosave.saveNow(store.getState().doc);
    expect(uploadPreview).toHaveBeenCalledTimes(1);
    expect(cancelIdle).toHaveBeenCalledWith(17);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-idle')).toHaveLength(1);
  });

  it('reuses the persisted preview for a name-only save', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-rename');
    addText(store, 'Edit');
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'preview-1' });
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    autosave.save(store.getState().doc);
    await flush();
    store.getState().setDesignName('Renamed');
    autosave.save(store.getState().doc);
    await flush();

    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-rename');
    expect(puts).toHaveLength(2);
    expect(uploadPreview).toHaveBeenCalledTimes(1);
    expect(JSON.parse((puts[1][1] as RequestInit).body as string)).toMatchObject({
      name: 'Renamed',
    });
    expect(JSON.parse((puts[1][1] as RequestInit).body as string).previewFileId).toBeUndefined();
  });

  it('does not reuse a cleaned-up preview File after undoing to an older doc', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-history-preview');
    const uploadPreview = vi.fn()
      .mockResolvedValueOnce({ previewFileId: 'preview-1' })
      .mockResolvedValueOnce({ previewFileId: 'preview-2' })
      .mockResolvedValueOnce({ previewFileId: 'preview-3' });
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    addText(store, 'First');
    autosave.save(store.getState().doc);
    await flush();
    addText(store, 'Second');
    autosave.save(store.getState().doc);
    await flush();
    store.getState().undo();
    autosave.save(store.getState().doc);
    await flush();

    expect(uploadPreview).toHaveBeenCalledTimes(3);
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-history-preview');
    expect(JSON.parse((puts[2][1] as RequestInit).body as string).previewFileId).toBe('preview-3');
  });

  it('serializes an older in-flight PUT before sending the newer document', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-serial');
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'First');
    autosave.save(store.getState().doc);
    await flush();
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-serial')).toHaveLength(1);

    addText(store, 'Second');
    const latestDoc = store.getState().doc;
    autosave.save(latestDoc);
    await flush();
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-serial')).toHaveLength(1);

    resolvers[0](okJson({}));
    await flush();
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-serial');
    expect(puts).toHaveLength(2);
    expect(JSON.parse((puts[1][1] as RequestInit).body as string).doc).toEqual(latestDoc);

    resolvers[1](okJson({}));
    await flush();
    expect(store.getState().doc).toBe(latestDoc);
    expect(store.getState().isDirty).toBe(false);
  });

  it('does not let one stalled design write block another design or its queued save', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-a');
    store.getState().setDesignName('Design A');
    const pending: { url: string; resolve: (response: Response) => void }[] = [];
    const fetchMock = vi.fn((url: string) => new Promise<Response>((resolve) => {
      pending.push({ url, resolve });
    }));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'A first');
    autosave.save(store.getState().doc);
    await flush();
    addText(store, 'A second');
    const secondA = store.getState().doc;
    autosave.save(secondA);
    await flush();
    expect(pending.map((request) => request.url)).toEqual(['/media/designs/design-a']);

    const other = createDesignerStore();
    store.getState().loadDesign(other.getState().doc, 'design-b', 'Design B');
    addText(store, 'B edit');
    autosave.save(store.getState().doc);
    await flush();
    expect(pending.map((request) => request.url)).toEqual([
      '/media/designs/design-a',
      '/media/designs/design-b',
    ]);

    pending[0].resolve(okJson({}));
    await flush();
    expect(pending.map((request) => request.url)).toHaveLength(3);
    const secondPut = fetchMock.mock.calls[2];
    expect(JSON.parse((secondPut[1] as RequestInit).body as string)).toMatchObject({
      name: 'Design A',
      doc: JSON.parse(JSON.stringify(secondA)),
    });
    pending[1].resolve(okJson({}));
    pending[2].resolve(okJson({}));
    await flush();
  });

  it('manual Save proceeds while an older same-design write is unsettled', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-stalled');
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    addText(store, 'First');
    autosave.save(store.getState().doc);
    await flush();
    addText(store, 'Manual latest');
    const latestDoc = store.getState().doc;
    const manual = autosave.saveNow(latestDoc);
    await flush();

    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-stalled');
    expect(puts).toHaveLength(2);
    expect(JSON.parse((puts[1][1] as RequestInit).body as string).doc).toEqual(latestDoc);
    resolvers[1](okJson({}));
    await expect(manual).resolves.toBe('persisted');
    expect(store.getState().isDirty).toBe(false);
    resolvers[0](okJson({}));
    await flush();
    const repairedPuts = callsTo(fetchMock, 'PUT', '/media/designs/design-stalled');
    expect(repairedPuts).toHaveLength(3);
    expect(JSON.parse((repairedPuts[2][1] as RequestInit).body as string).doc).toEqual(latestDoc);
    resolvers[2](okJson({}));
    await flush();
    expect(store.getState().doc).toBe(latestDoc);
    expect(store.getState().isDirty).toBe(false);
  });

  it('times out an unsettled PUT and retries instead of blocking the design forever', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    store.getState().setDesignId('design-timeout');
    addText(store, 'Edit');
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(store.getState().saveFailed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-timeout')).toHaveLength(2);
  });

  it('does not join an identical manual Save to a request already hung on the network', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    store.getState().setDesignId('design-identical-timeout');
    addText(store, 'Edit');
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });

    autosave.save(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    const manual = autosave.saveNow(store.getState().doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-identical-timeout')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30000);
    await expect(manual).resolves.toBe('failed');
  });

  it('captures the original design and document for an idle preview', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-original');
    store.getState().setDesignName('Original name');
    addText(store, 'Original doc');
    const originalDoc = store.getState().doc;
    let idle: (() => void) | null = null;
    vi.stubGlobal('requestIdleCallback', vi.fn((work: () => void) => {
      idle = work;
      return 19;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const uploadPreview = vi.fn().mockResolvedValue({ previewFileId: 'original-preview' });
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    autosave.save(originalDoc);
    await Promise.resolve();
    await Promise.resolve();
    const other = createDesignerStore();
    store.getState().loadDesign(other.getState().doc, 'design-other', 'Other design');
    idle!();
    await flush();

    expect(uploadPreview).toHaveBeenCalledWith(originalDoc);
    const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-original');
    expect(puts).toHaveLength(1);
    expect(JSON.parse((puts[0][1] as RequestInit).body as string)).toMatchObject({
      name: 'Original name',
      doc: JSON.parse(JSON.stringify(originalDoc)),
      previewFileId: 'original-preview',
    });
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-other')).toHaveLength(0);
  });

  it('trashes a stale preview upload and omits it from the older PUT', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-stale-preview');
    let resolvePreview: (preview: PreviewUpload) => void = () => {};
    const uploadPreview = vi.fn(() => new Promise<PreviewUpload>((resolve) => {
      resolvePreview = resolve;
    }));
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });

    addText(store, 'First');
    const sentDoc = store.getState().doc;
    autosave.save(sentDoc);
    await flush();
    addText(store, 'Newer edit');
    resolvePreview({ previewFileId: 'stale-preview' });
    await flush();

    expect(callsTo(fetchMock, 'POST', '/files/stale-preview/trash')).toHaveLength(1);
    const put = callsTo(fetchMock, 'PUT', '/media/designs/design-stale-preview')[0];
    expect(JSON.parse((put[1] as RequestInit).body as string).previewFileId).toBeUndefined();
    expect(store.getState().isDirty).toBe(true);
  });
});

describe('createAutosaveSubscription', () => {
  afterEach(() => {
    vi.useRealTimers();
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
    // The id notification coalesces into the completed create, not a duplicate PUT.
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-r1')).toHaveLength(0);
    expect(store.getState().isDirty).toBe(false);
  });

  it('does not autosave during a static gesture and saves once after it ends', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    store.getState().setDesignId('design-static-gesture');
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const autosave = createDesignAutosave({
      store,
      fetchFn: fetchMock,
      uploadPreview: vi.fn().mockResolvedValue({}),
    });
    const unsubscribe = createAutosaveSubscription(store, autosave, 2000);

    store.getState().beginGesture();
    addText(store, 'Gesture edit');
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().updateElementsEphemeral([{ id, updates: { x: 50 } }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).not.toHaveBeenCalled();

    store.getState().commitElementGesture([{ id, updates: { x: 60 } }]);
    store.getState().endGesture();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-static-gesture')).toHaveLength(1);
    unsubscribe();
  });

  it('does not autosave during a video clip gesture', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    store.getState().setDesignId('design-video-gesture');
    addVideo(store);
    store.getState().markSaved();
    const fetchMock = vi.fn(() => Promise.resolve(okJson({})));
    const uploadPreview = vi.fn().mockResolvedValue({});
    const autosave = createDesignAutosave({ store, fetchFn: fetchMock, uploadPreview });
    const unsubscribe = createAutosaveSubscription(store, autosave, 2000);
    const output = store.getState().doc.outputs[0];
    if (!('tracks' in output)) throw new Error('Expected video output');
    const clip = output.tracks[0].clips[0];

    store.getState().beginGesture();
    store.getState().updateClipSilent(0, output.tracks[0].id, clip.id, { volume: 0.4 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).not.toHaveBeenCalled();

    store.getState().pushHistory('Edit clip');
    store.getState().endGesture();
    await vi.advanceTimersByTimeAsync(2000);
    expect(callsTo(fetchMock, 'PUT', '/media/designs/design-video-gesture')).toHaveLength(1);
    expect(uploadPreview).not.toHaveBeenCalled();
    unsubscribe();
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

  it('saves the dirty base document during preview and re-arms on preview end', async () => {
    const store = createDesignerStore(1080, 1080);
    const save = vi.fn();
    const unsubscribe = createAutosaveSubscription(store, {
      save,
      ensureCreated: vi.fn(),
      createInFlight: () => null,
    }, 5);
    addText(store, 'Preview');
    const id = store.getState().doc.outputs[0].children[0].id;

    store.getState().previewElements({ [id]: { fontSize: 72 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].outputs[0].children[0].fontSize).toBeUndefined();

    store.getState().clearElementPreview();
    await new Promise((resolve) => setTimeout(resolve, 30));
    unsubscribe();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].outputs[0].children[0].fontSize).toBeUndefined();
  });

  it('does not drop an undo save when its previewing inspector unmounts', async () => {
    const store = createDesignerStore(1080, 1080);
    const save = vi.fn();
    const unsubscribe = createAutosaveSubscription(store, {
      save,
      ensureCreated: vi.fn(),
      createInFlight: () => null,
    }, 5);
    addText(store, 'First');
    addText(store, 'Second');
    const id = store.getState().doc.outputs[0].children[1].id;
    store.getState().previewElements({ [id]: { fontSize: 72 } });

    store.getState().undo();
    store.getState().clearElementPreview();
    await new Promise((resolve) => setTimeout(resolve, 30));
    unsubscribe();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].outputs[0].children).toHaveLength(1);
    expect(save.mock.calls[0][0].outputs[0].children[0].fontSize).toBeUndefined();
  });

  it('retries a real dirty document while a preview projection is active', async () => {
    vi.useFakeTimers();
    try {
      const store = createDesignerStore(1080, 1080);
      store.getState().setDesignId('design-preview-retry');
      addText(store, 'Base text');
      const id = store.getState().doc.outputs[0].children[0].id;
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('backend down'))
        .mockImplementation(() => Promise.resolve(okJson({})));
      const autosave = createDesignAutosave({
        store,
        fetchFn: fetchMock,
        uploadPreview: vi.fn().mockResolvedValue({}),
      });

      autosave.save(store.getState().doc);
      await vi.advanceTimersByTimeAsync(0);
      store.getState().previewElements({ [id]: { fontSize: 72 } });
      await vi.advanceTimersByTimeAsync(2000);

      const puts = callsTo(fetchMock, 'PUT', '/media/designs/design-preview-retry');
      expect(puts).toHaveLength(2);
      const retryBody = JSON.parse((puts[1][1] as RequestInit).body as string);
      expect(retryBody.doc.outputs[0].children[0].fontSize).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
