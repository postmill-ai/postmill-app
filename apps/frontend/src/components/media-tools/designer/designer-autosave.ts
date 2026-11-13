import type { DesignerDoc, createDesignerStore } from './designer.store';
import { isBlankDoc } from './designer-doc-blank';
import * as Sentry from '@sentry/nextjs';

type DesignerStoreApi = ReturnType<typeof createDesignerStore>;

export interface PreviewUpload {
  previewFileId?: string;
  previewDataUrl?: string;
}

export interface DesignAutosaveDeps {
  store: DesignerStoreApi;
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  uploadPreview: (doc: DesignerDoc) => Promise<PreviewUpload>;
}

export type SaveResult = 'persisted' | 'skipped' | 'failed';

/**
 * A failed autosave used to throw a bare 'Autosave PUT failed' — the server's
 * actual reason (e.g. the DesignerDoc validation issues on a 400) never
 * reached anyone, so a design whose doc tripped a schema rule failed EVERY
 * save forever with no way to find out why. Pull the message — and any
 * validation issue paths — out of the response body and report it: the pill
 * stays generic, but the console and Sentry now carry the cause.
 */
const autosaveError = async (
  res: Response,
  fallback: string
): Promise<Error> => {
  let message = fallback;
  try {
    const body = await res.json();
    const base =
      typeof body?.message === 'string' && body.message
        ? body.message
        : Array.isArray(body?.message)
          ? body.message
              .filter((m: unknown): m is string => typeof m === 'string')
              .join(' ')
          : typeof body?.error === 'string' && body.error
            ? body.error
            : fallback;
    const issues = Array.isArray(body?.issues)
      ? body.issues
          .slice(0, 5)
          .map(
            (i: { path?: unknown; message?: unknown }) =>
              `${Array.isArray(i?.path) ? i.path.join('.') : ''}: ${i?.message}`
          )
          .join('; ')
      : '';
    message = issues ? `${base} (${issues})` : base;
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  const err = new Error(`${fallback}: ${res.status} ${message}`);
  console.error(err.message);
  Sentry.captureException(err);
  return err;
};

/**
 * Autosave runs on a store subscription, not on render: a trailing debounce
 * watches doc AND name (the PUT carries both, so a pure rename must wake the
 * same pipeline), and a create landing its id re-fires the save so the PUT
 * cycle picks up the latest doc (it no-ops on a clean store). Moving it out
 * of React is what lets the root stop subscribing to `doc`.
 *
 * `prev` is advanced BEFORE any branch runs: the designId branch calls save()
 * synchronously, and save()'s setSaving() re-fires this subscriber
 * re-entrantly — a stale prev would see the same designId transition again
 * and recurse until the stack blows (Sentry APP-18).
 */
export const createAutosaveSubscription = (
  store: DesignerStoreApi,
  designAutosave: DesignAutosave,
  debounceMs = 2000
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let prev = store.getState();
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      const s = store.getState();
      if (s.isDirty && s.gestureDepth === 0) designAutosave.save(s.doc);
    }, debounceMs);
  };
  const unsubscribe = store.subscribe((state) => {
    const prevState = prev;
    prev = state;
    if (state.doc !== prevState.doc || state.designName !== prevState.designName) {
      if (state.gestureDepth > 0) clearTimer();
      else schedule();
    } else if (state.gestureDepth === 0 && prevState.gestureDepth > 0) {
      if (state.isDirty) schedule();
    } else if (
      state.previewRevision !== prevState.previewRevision &&
      !state.isPreviewing &&
      state.isDirty &&
      state.gestureDepth === 0
    ) {
      schedule();
    } else if (
      state.designId !== prevState.designId &&
      state.designId &&
      state.gestureDepth === 0
    ) {
      designAutosave.save(state.doc);
    }
  });
  return () => {
    unsubscribe();
    clearTimer();
  };
};

export interface DesignAutosave {
  /**
   * Debounced-doc entry point. First edit on a brand-new design POSTs it once
   * (there is no id for the PUT cycle yet); afterwards every call PUTs. A
   * pristine doc (not dirty) is never persisted, and neither is a dirty but
   * still-blank doc with no designId yet (never POST a create for an
   * untouched canvas).
   */
  save: (sentDoc: DesignerDoc) => void;
  /** Manual Save: bypass debounce, idle capture, retry pause, and queued writes. */
  saveNow: (sentDoc: DesignerDoc) => Promise<SaveResult>;
  /**
   * Create the design once and resolve to its id. Concurrent callers in the
   * same design session share the in-flight POST, so Cmd+S mid-create cannot
   * mint a duplicate design.
   */
  ensureCreated: () => Promise<string>;
  /** The in-flight create promise, or null when idle. */
  createInFlight: () => Promise<string> | null;
}

export const createDesignAutosave = ({
  store,
  fetchFn,
  uploadPreview,
}: DesignAutosaveDeps): DesignAutosave => {
  type SaveRequest = {
    designId: string | null;
    session: number;
    sentDoc: DesignerDoc;
    sentName: string;
    immediate: boolean;
    networkStarted: boolean;
  };
  type PendingSave = {
    name: string;
    started: boolean;
    request: SaveRequest;
    promise: Promise<SaveResult>;
  };
  type SaveQueue = {
    designId: string | null;
    session: number;
    tail: Promise<unknown>;
    pending: Map<DesignerDoc, PendingSave[]>;
    createPromise: Promise<string> | null;
    createDoc: DesignerDoc | null;
  };
  type RetryState = {
    timer: ReturnType<typeof setTimeout> | null;
    attempt: number;
    consecutiveFailures: number;
    pausedOn: SaveRequest | null;
    lastFailed: { doc: DesignerDoc; name: string; preview: PreviewUpload } | null;
  };
  const newSaveQueue = (session: number): SaveQueue => ({
    designId: null,
    session,
    tail: Promise.resolve(),
    pending: new Map(),
    createPromise: null,
    createDoc: null,
  });
  const newRetryState = (): RetryState => ({
    timer: null,
    attempt: 0,
    consecutiveFailures: 0,
    pausedOn: null,
    lastFailed: null,
  });
  const setBounded = <K, V>(map: Map<K, V>, key: K, value: V) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > 25) map.delete(map.keys().next().value as K);
  };
  const designQueues = new Map<string, SaveQueue>();
  let activeNewQueue = newSaveQueue(store.getState().designSession);
  const createdDesignIds = new WeakMap<DesignerDoc, { id: string; session: number }>();
  const lastPersistedDocs = new Map<string, DesignerDoc>();
  let writeSequence = 0;
  const latestWriteStarted = new Map<string, number>();
  const latestSuccessfulWrites = new Map<string, {
    sequence: number;
    request: SaveRequest & { designId: string };
  }>();
  const retryStates = new Map<string, RetryState>();
  let activeWrites = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;
  const SAVE_REQUEST_TIMEOUT_MS = 30000;

  const beginSaving = () => {
    activeWrites += 1;
    store.getState().setSaving(true);
  };
  const endSaving = () => {
    activeWrites = Math.max(0, activeWrites - 1);
    if (activeWrites === 0) store.getState().setSaving(false);
  };
  const isCurrentDesign = (request: SaveRequest) => {
    const state = store.getState();
    return state.designId === request.designId && state.designSession === request.session;
  };
  const retryKey = (request: SaveRequest) => request.designId ?? `new:${request.session}`;
  const retryStateFor = (request: SaveRequest) => {
    const key = retryKey(request);
    let state = retryStates.get(key);
    if (!state) {
      state = newRetryState();
      retryStates.set(key, state);
    }
    return state;
  };

  type PreviewTask = { promise: Promise<PreviewUpload>; start: () => void };
  const previewTasks = new Map<DesignerDoc, PreviewTask>();
  const schedulePreview = (work: () => void) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(work, { timeout: 1000 });
      return () => globalThis.cancelIdleCallback(id);
    }
    const id = setTimeout(work, 0);
    return () => clearTimeout(id);
  };
  const previewFor = (doc: DesignerDoc, immediate: boolean): Promise<PreviewUpload> => {
    if (doc.mode === 'video') return Promise.resolve({});
    const existing = previewTasks.get(doc);
    if (existing) {
      if (immediate) existing.start();
      return existing.promise;
    }
    let cancelIdle = () => {};
    let started = false;
    let resolveTask: (preview: PreviewUpload) => void = () => {};
    const promise = new Promise<PreviewUpload>((resolve) => {
      resolveTask = resolve;
    });
    const start = () => {
      if (started) return;
      started = true;
      cancelIdle();
      uploadPreview(doc).then(resolveTask, () => resolveTask({}));
    };
    const task = { promise, start };
    previewTasks.set(doc, task);
    if (immediate) start();
    else cancelIdle = schedulePreview(start);
    return promise;
  };

  const clearRetry = (request: SaveRequest) => {
    const state = retryStateFor(request);
    if (state.timer) clearTimeout(state.timer);
    retryStates.delete(retryKey(request));
  };

  const resumeImmediate = (request: SaveRequest) => {
    const state = retryStateFor(request);
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.attempt = 0;
    state.consecutiveFailures = 0;
    state.pausedOn = null;
    if (isCurrentDesign(request)) store.getState().setSaveRetryPaused(false);
  };

  const scheduleRetry = (request: SaveRequest) => {
    const state = retryStateFor(request);
    if (isCurrentDesign(request)) store.getState().setSaveFailed(true);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.pausedOn = request;
      if (isCurrentDesign(request)) store.getState().setSaveRetryPaused(true);
      return;
    }
    if (state.timer) return;
    const delay = Math.min(30000, 2000 * 2 ** state.attempt);
    state.attempt += 1;
    state.timer = setTimeout(() => {
      state.timer = null;
      const s = store.getState();
      if (isCurrentDesign(request)) {
        if (!s.isDirty) {
          s.setSaveFailed(false);
          clearRetry(request);
          return;
        }
        enqueueSave({ ...request, sentDoc: s.doc, sentName: s.designName, networkStarted: false });
        return;
      }
      enqueueSave(request);
    }, delay);
  };

  const notePersisted = (request: SaveRequest) => {
    clearRetry(request);
    if (!isCurrentDesign(request)) return;
    const s = store.getState();
    s.setSaveFailed(false);
    s.setSaveRetryPaused(false);
  };

  const retainPreview = (sentDoc: DesignerDoc, persistedDoc: DesignerDoc) => {
    const task = previewTasks.get(sentDoc);
    previewTasks.clear();
    if (task) previewTasks.set(persistedDoc, task);
  };

  const queueFor = (request: SaveRequest): SaveQueue => {
    if (request.designId) {
      let queue = designQueues.get(request.designId);
      if (!queue) {
        queue = newSaveQueue(request.session);
        queue.designId = request.designId;
        designQueues.set(request.designId, queue);
      }
      return queue;
    }
    if (activeNewQueue.designId || activeNewQueue.session !== request.session) {
      activeNewQueue = newSaveQueue(request.session);
    }
    return activeNewQueue;
  };

  const enqueueSave = (request: SaveRequest): Promise<SaveResult> => {
    const queue = queueFor(request);
    const pending = queue.pending.get(request.sentDoc) ?? [];
    const existing = pending.find((entry) => entry.name === request.sentName);
    if (existing) {
      if (request.immediate) previewTasks.get(request.sentDoc)?.start();
      return existing.promise;
    }
    const entry: PendingSave = {
      name: request.sentName,
      started: false,
      request,
      promise: Promise.resolve<SaveResult>('skipped'),
    };
    const promise = queue.tail.then(() => {
      entry.started = true;
      return persist(request);
    });
    entry.promise = promise;
    queue.pending.set(request.sentDoc, [...pending, entry]);
    queue.tail = promise.then(
      (result) => {
        if (result === 'failed') scheduleRetry(request);
      },
      () => {}
    );
    const settled = () => {
      const current = queue.pending.get(request.sentDoc) ?? [];
      const remaining = current.filter((candidate) => candidate !== entry);
      if (remaining.length) queue.pending.set(request.sentDoc, remaining);
      else queue.pending.delete(request.sentDoc);
      if (queue.designId && !queue.pending.size && !queue.createPromise) {
        designQueues.delete(queue.designId);
      }
    };
    promise.then(settled, settled);
    return promise;
  };

  const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Design save timed out'));
      }, SAVE_REQUEST_TIMEOUT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    try {
      return await Promise.race([
        fetchFn(url, { ...init, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer!);
    }
  };

  const ensureCreatedFor = (request: SaveRequest): Promise<string> => {
    const { sentDoc, sentName, immediate } = request;
    const state = store.getState();
    const created = createdDesignIds.get(sentDoc);
    const existing = request.designId ??
      (created?.session === request.session ? created.id : null) ??
      (state.designSession === request.session && state.doc === sentDoc ? state.designId : null);
    if (existing) return Promise.resolve(existing);
    const queue = queueFor(request);
    if (queue.createPromise) {
      if (immediate && queue.createDoc) previewTasks.get(queue.createDoc)?.start();
      return queue.createPromise;
    }
    queue.createDoc = sentDoc;
    beginSaving();
    const promise = (async () => {
      try {
        const failed = retryStateFor(request).lastFailed;
        const { previewFileId, previewDataUrl } = sentDoc.mode === 'video'
          ? {} as PreviewUpload
          : failed && failed.doc === sentDoc && failed.name === sentName
            ? failed.preview
            : await previewFor(sentDoc, immediate);
        const payload: Record<string, unknown> = {
          name: sentName,
          doc: sentDoc,
          width: sentDoc.outputs[0]?.width,
          height: sentDoc.outputs[0]?.height,
        };
        if (previewFileId) payload.previewFileId = previewFileId;
        else if (previewDataUrl) payload.previewDataUrl = previewDataUrl;
        let res: Response;
        try {
          request.networkStarted = true;
          res = await fetchFn('/media/designs', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (err) {
          retryStateFor(request).lastFailed = {
            doc: sentDoc,
            name: sentName,
            preview: { previewFileId, previewDataUrl },
          };
          throw err;
        }
        if (!res.ok) {
          retryStateFor(request).lastFailed = {
            doc: sentDoc,
            name: sentName,
            preview: { previewFileId, previewDataUrl },
          };
          throw await autosaveError(res, 'Autosave create failed');
        }
        const data = await res.json();
        const designId = data.id as string;
        const persistedDoc = data.doc as DesignerDoc | undefined;
        createdDesignIds.set(sentDoc, { id: designId, session: request.session });
        queue.designId = designId;
        designQueues.set(designId, queue);
        const before = store.getState();
        if (before.designSession === request.session && !before.designId) {
          before.setDesignId(designId);
        }
        const after = store.getState();
        let retainedDoc = persistedDoc ?? sentDoc;
        if (after.designSession === request.session && after.designId === designId) {
          createdDesignIds.set(after.doc, { id: designId, session: request.session });
          if (after.doc === sentDoc && after.designName === sentName) {
            if (persistedDoc) after.adoptPersistedDoc(sentDoc, persistedDoc);
            retainedDoc = store.getState().doc;
            store.getState().markSaved();
            if (activeWrites > 1) store.getState().setSaving(true);
          }
        }
        setBounded(lastPersistedDocs, designId, retainedDoc);
        retainPreview(sentDoc, retainedDoc);
        clearRetry(request);
        notePersisted({ ...request, designId });
        return designId;
      } finally {
        if (queue.createPromise === promise) {
          queue.createPromise = null;
          queue.createDoc = null;
        }
        endSaving();
      }
    })();
    queue.createPromise = promise;
    return promise;
  };

  const ensureCreated = (): Promise<string> => {
    const state = store.getState();
    return ensureCreatedFor({
      designId: state.designId,
      session: state.designSession,
      sentDoc: state.doc,
      sentName: state.designName,
      immediate: true,
      networkStarted: false,
    });
  };

  const putDoc = async (request: SaveRequest & { designId: string }) => {
    const { designId, sentDoc, sentName, immediate } = request;
    const failed = retryStateFor(request).lastFailed;
    let preview: PreviewUpload = {};
    if (sentDoc.mode !== 'video' && lastPersistedDocs.get(designId) !== sentDoc) {
      if (failed && failed.doc === sentDoc) {
        preview = failed.preview;
      } else {
        preview = await previewFor(sentDoc, immediate);
        const current = store.getState();
        if (current.designSession === request.session && current.designId === designId && current.doc !== sentDoc) {
          if (preview.previewFileId) {
            previewTasks.delete(sentDoc);
            fetchFn(`/files/${preview.previewFileId}/trash`, { method: 'POST' }).catch(() => {});
          }
          preview = {};
        }
      }
    }
    const body = JSON.stringify({ name: sentName, doc: sentDoc, ...preview });
    let res: Response;
    try {
      request.networkStarted = true;
      res = await fetchWithTimeout(`/media/designs/${designId}`, {
        method: 'PUT',
        body,
      });
    } catch (err) {
      retryStateFor(request).lastFailed = { doc: sentDoc, name: sentName, preview };
      throw err;
    }
    if (!res.ok) {
      retryStateFor(request).lastFailed = { doc: sentDoc, name: sentName, preview };
      throw await autosaveError(res, 'Autosave PUT failed');
    }
    const data = await res.json();
    return data.doc as DesignerDoc | undefined;
  };

  const persistPut = async (
    request: SaveRequest & { designId: string }
  ): Promise<SaveResult> => {
    const { designId, sentDoc, sentName } = request;
    const sequence = ++writeSequence;
    setBounded(latestWriteStarted, designId, sequence);
    beginSaving();
    try {
      const persistedDoc = await putDoc(request);
      const newerSuccess = latestSuccessfulWrites.get(designId);
      const repair = newerSuccess && newerSuccess.sequence > sequence &&
        latestWriteStarted.get(designId) === newerSuccess.sequence
        ? newerSuccess.request
        : null;
      if (!repair) setBounded(latestSuccessfulWrites, designId, { sequence, request });
      const s = store.getState();
      const canAdopt = s.designSession === request.session && s.designId === designId &&
        s.doc === sentDoc && s.designName === sentName;
      let retainedDoc = persistedDoc ?? sentDoc;
      if (canAdopt) {
        if (persistedDoc) s.adoptPersistedDoc(sentDoc, persistedDoc);
        retainedDoc = store.getState().doc;
        store.getState().markSaved();
        if (activeWrites > 1) store.getState().setSaving(true);
      }
      if (!repair) {
        setBounded(lastPersistedDocs, designId, retainedDoc);
        retainPreview(sentDoc, retainedDoc);
      }
      notePersisted(request);
      if (repair) await persistPut(repair);
      return 'persisted';
    } finally {
      endSaving();
    }
  };

  const persist = async (request: SaveRequest): Promise<SaveResult> => {
    const state = store.getState();
    const retryState = retryStateFor(request);
    if (request.immediate) resumeImmediate(request);
    else if (retryState.pausedOn?.designId === request.designId && retryState.pausedOn.session === request.session) {
      if (retryState.pausedOn.sentDoc === request.sentDoc && retryState.pausedOn.sentName === request.sentName) {
        return 'skipped';
      }
      retryState.pausedOn = null;
      retryState.consecutiveFailures = 0;
      retryState.attempt = 0;
      if (isCurrentDesign(request)) state.setSaveRetryPaused(false);
    }
    if (request.designId && state.designSession === request.session && state.designId === request.designId) {
      if (!state.isDirty || state.doc !== request.sentDoc || state.designName !== request.sentName) {
        return 'skipped';
      }
    } else if (!request.designId && state.designId === null && state.designSession === request.session && state.doc === request.sentDoc && !state.isDirty) {
      return 'skipped';
    }
    if (!request.designId && state.designId && state.doc !== request.sentDoc) {
      return 'skipped';
    }
    if (!request.designId && isBlankDoc(request.sentDoc) && !request.immediate) {
      clearRetry(request);
      if (isCurrentDesign(request)) {
        state.setSaveFailed(false);
        state.setSaveRetryPaused(false);
      }
      return 'skipped';
    }
    try {
      const created = createdDesignIds.get(request.sentDoc);
      const designId = request.designId ??
        (created?.session === request.session ? created.id : null) ??
        (state.designSession === request.session && state.doc === request.sentDoc ? state.designId : null);
      if (designId) return await persistPut(Object.assign(request, { designId }));
      const createdId = await ensureCreatedFor(request);
      const after = store.getState();
      if (after.designSession === request.session && after.designId === createdId && after.isDirty) {
        createdDesignIds.set(after.doc, { id: createdId, session: request.session });
        return await persistPut({
          ...request,
          designId: createdId,
          sentDoc: after.doc,
          sentName: after.designName,
          networkStarted: false,
        });
      }
      return 'persisted';
    } catch {
      if (isCurrentDesign(request)) store.getState().setSaveFailed(true);
      return 'failed';
    }
  };

  const requestFor = (sentDoc: DesignerDoc, immediate: boolean): SaveRequest => {
    const state = store.getState();
    return {
      designId: state.designId,
      session: state.designSession,
      sentDoc,
      sentName: state.designName,
      immediate,
      networkStarted: false,
    };
  };

  const save = (sentDoc: DesignerDoc) => {
    if (store.getState().gestureDepth > 0) return;
    void enqueueSave(requestFor(sentDoc, false));
  };

  const saveNow = async (sentDoc: DesignerDoc): Promise<SaveResult> => {
    const request = requestFor(sentDoc, true);
    const queue = queueFor(request);
    const pending = queue.pending.get(sentDoc) ?? [];
    const existing = pending.find((entry) =>
      entry.name === request.sentName && entry.started && !entry.request.networkStarted
    );
    if (existing) {
      previewTasks.get(sentDoc)?.start();
      return existing.promise;
    }
    const result = await persist(request);
    if (result === 'failed') scheduleRetry(request);
    return result;
  };

  return {
    save,
    saveNow,
    ensureCreated,
    createInFlight: () => {
      const state = store.getState();
      const queue = state.designId ? designQueues.get(state.designId) : activeNewQueue;
      return queue?.createPromise ?? null;
    },
  };
};
