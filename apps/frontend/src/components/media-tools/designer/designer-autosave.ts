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
  uploadPreview: () => Promise<PreviewUpload>;
}

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
  /** Manual Save: skip debounce/idle capture and wait for the queued write. */
  saveNow: (sentDoc: DesignerDoc) => Promise<void>;
  /**
   * Create the design once and resolve to its id. Concurrent callers share the
   * same in-flight POST — manual Save awaits this so Cmd+S mid-create can
   * never mint a duplicate design.
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
  let createPromise: Promise<string> | null = null;
  let createDoc: DesignerDoc | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  /**
   * Retries are bounded: after this many CONSECUTIVE failures the pipeline
   * pauses instead of hammering a down backend with a serialize + upload every
   * ≤30s forever. The next real edit (doc or name moves on from the paused
   * snapshot) re-arms it.
   */
  const MAX_CONSECUTIVE_FAILURES = 5;
  let consecutiveFailures = 0;
  let pausedOn: { doc: DesignerDoc; name: string } | null = null;
  /**
   * The last failed write's snapshot. A retry for the SAME doc reuses the
   * already-uploaded preview instead of re-serializing the canvas and
   * re-uploading an identical thumbnail on every backoff attempt (each of
   * which also orphaned a File row until the next successful save).
   */
  let lastFailed: { doc: DesignerDoc; name: string; preview: PreviewUpload } | null = null;
  let lastPersistedDoc: DesignerDoc | null = null;

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
      uploadPreview().then(resolveTask, () => resolveTask({}));
    };
    const task = { promise, start };
    previewTasks.set(doc, task);
    if (immediate) start();
    else cancelIdle = schedulePreview(start);
    return promise;
  };

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
    consecutiveFailures = 0;
    lastFailed = null;
    pausedOn = null;
  };

  /**
   * A failed autosave used to end at setSaving(false) — silent data loss the
   * header read as "Unsaved" forever. Surface it (`saveFailed`, the header's
   * pill) and retry with exponential backoff — bounded, see above: when the
   * cap is hit the pill switches to "paused" until the next edit.
   */
  const scheduleRetry = () => {
    const s = store.getState();
    s.setSaveFailed(true);
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedOn = { doc: s.doc, name: s.designName };
      s.setSaveRetryPaused(true);
      return;
    }
    if (retryTimer) return;
    const delay = Math.min(30000, 2000 * 2 ** retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const s = store.getState();
      if (!s.isDirty) {
        s.setSaveFailed(false);
        retryAttempt = 0;
        consecutiveFailures = 0;
        lastFailed = null;
        return;
      }
      save(s.doc);
    }, delay);
  };

  const notePersisted = () => {
    clearRetry();
    const s = store.getState();
    s.setSaveFailed(false);
    s.setSaveRetryPaused(false);
  };

  const retainPreview = (sentDoc: DesignerDoc) => {
    const task = previewTasks.get(sentDoc);
    previewTasks.clear();
    if (lastPersistedDoc && task) previewTasks.set(lastPersistedDoc, task);
  };

  const ensureCreated = (immediate = true): Promise<string> => {
    const existing = store.getState().designId;
    if (existing) return Promise.resolve(existing);
    if (createPromise) {
      if (immediate && createDoc) previewTasks.get(createDoc)?.start();
      return createPromise;
    }
    createDoc = store.getState().doc;
    createPromise = (async () => {
      try {
        const s = store.getState();
        const sentDoc = s.doc;
        const sentName = s.designName;
        // Preview work is shared by doc reference; manual Save can promote an
        // idle capture to immediate work without starting a second upload.
        const { previewFileId, previewDataUrl } = sentDoc.mode === 'video'
          ? {} as PreviewUpload
          : lastFailed && lastFailed.doc === sentDoc && lastFailed.name === sentName
            ? lastFailed.preview
            : await previewFor(sentDoc, immediate);
        const payload: Record<string, unknown> = {
          name: sentName,
          doc: sentDoc,
          width: sentDoc.outputs[0]?.width,
          height: sentDoc.outputs[0]?.height,
        };
        if (previewFileId) payload.previewFileId = previewFileId;
        // Only ship the base64 preview as a fallback when the upload failed,
        // to keep the save JSON small.
        else if (previewDataUrl) payload.previewDataUrl = previewDataUrl;
        let res: Response;
        try {
          res = await fetchFn('/media/designs', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (err) {
          lastFailed = { doc: sentDoc, name: sentName, preview: { previewFileId, previewDataUrl } };
          throw err;
        }
        if (!res.ok) {
          lastFailed = { doc: sentDoc, name: sentName, preview: { previewFileId, previewDataUrl } };
          throw await autosaveError(res, 'Autosave create failed');
        }
        const data = await res.json();
        // Another flow (template apply) may have landed an id while the POST
        // was in flight — never clobber it; this row just goes unreferenced.
        if (!store.getState().designId) {
          store.getState().setDesignId(data.id);
        }
        // Only mark saved when no edit landed mid-flight — zustand replaces
        // the doc object on every edit, so a reference mismatch means unsaved
        // changes exist and must not be marked "Saved". Same for the name: a
        // rename mid-POST is unsaved work the PUT cycle must pick up.
        const after = store.getState();
        if (after.doc === sentDoc && after.designName === sentName) {
          if (data.doc) after.adoptPersistedDoc(sentDoc, data.doc);
          lastPersistedDoc = store.getState().doc;
          store.getState().markSaved();
        } else {
          lastPersistedDoc = (data.doc as DesignerDoc | undefined) ?? sentDoc;
        }
        retainPreview(sentDoc);
        notePersisted();
        return data.id as string;
      } finally {
        createPromise = null;
        createDoc = null;
      }
    })();
    return createPromise;
  };

  const putDoc = async (designId: string, sentDoc: DesignerDoc, immediate: boolean) => {
    // A name-only save needs no new bitmap. Otherwise share capture/upload by
    // doc reference, and never attach a stale upload to a newer document.
    let preview: PreviewUpload = {};
    if (
      sentDoc.mode !== 'video' &&
      lastPersistedDoc !== sentDoc &&
      store.getState().doc === sentDoc
    ) {
      if (lastFailed && lastFailed.doc === sentDoc) {
        preview = lastFailed.preview;
      } else {
        preview = await previewFor(sentDoc, immediate);
        if (store.getState().doc !== sentDoc) {
          if (preview.previewFileId) {
            previewTasks.delete(sentDoc);
            fetchFn(`/files/${preview.previewFileId}/trash`, { method: 'POST' }).catch(() => {});
          }
          preview = {};
        }
      }
    }
    // Read the name at send time, not at schedule time: a rename that landed
    // while the preview uploaded must ride along, or the library name would
    // lag the header (and a later markSaved would bury it — see save()).
    const sentName = store.getState().designName;
    const body = JSON.stringify({ name: sentName, doc: sentDoc, ...preview });
    let res: Response;
    try {
      res = await fetchFn(`/media/designs/${designId}`, {
        method: 'PUT',
        body,
      });
    } catch (err) {
      lastFailed = { doc: sentDoc, name: sentName, preview };
      throw err;
    }
    // A non-OK response is a failed write too — previously it fell through to
    // markSaved and silently dropped the edits.
    if (!res.ok) {
      lastFailed = { doc: sentDoc, name: sentName, preview };
      throw await autosaveError(res, 'Autosave PUT failed');
    }
    const data = await res.json();
    return { sentName, persistedDoc: data.doc as DesignerDoc | undefined };
  };

  const persistPut = async (designId: string, sentDoc: DesignerDoc, immediate: boolean) => {
    store.getState().setSaving(true);
    const { sentName, persistedDoc } = await putDoc(designId, sentDoc, immediate);
    const s = store.getState();
    if (s.doc === sentDoc && s.designName === sentName) {
      if (persistedDoc) s.adoptPersistedDoc(sentDoc, persistedDoc);
      lastPersistedDoc = store.getState().doc;
      store.getState().markSaved();
    } else {
      lastPersistedDoc = persistedDoc ?? sentDoc;
      s.setSaving(false);
    }
    retainPreview(sentDoc);
    notePersisted();
  };

  const persist = async (sentDoc: DesignerDoc, immediate: boolean) => {
    const state = store.getState();
    if (!state.isDirty || state.doc !== sentDoc) return;
    if (pausedOn) {
      if (state.doc === pausedOn.doc && state.designName === pausedOn.name) return;
      pausedOn = null;
      consecutiveFailures = 0;
      retryAttempt = 0;
      state.setSaveRetryPaused(false);
    }
    if (!state.designId && isBlankDoc(sentDoc)) {
      clearRetry();
      state.setSaveFailed(false);
      state.setSaveRetryPaused(false);
      return;
    }
    try {
      if (!state.designId) {
        await ensureCreated(immediate);
        const after = store.getState();
        if (after.designId && after.isDirty) {
          await persistPut(after.designId, after.doc, immediate);
        }
        return;
      }
      await persistPut(state.designId, sentDoc, immediate);
    } catch (err) {
      store.getState().setSaving(false);
      throw err;
    }
  };

  type PendingSave = { name: string; immediate: boolean; promise: Promise<void> };
  const pendingSaves = new Map<DesignerDoc, PendingSave[]>();
  let writeChain: Promise<unknown> = Promise.resolve();
  const enqueueSave = (sentDoc: DesignerDoc, immediate: boolean): Promise<void> => {
    const name = store.getState().designName;
    const pending = pendingSaves.get(sentDoc) ?? [];
    const existing = pending.find((entry) => entry.name === name);
    if (existing) {
      if (immediate) {
        existing.immediate = true;
        previewTasks.get(sentDoc)?.start();
      }
      return existing.promise;
    }
    const entry: PendingSave = { name, immediate, promise: Promise.resolve() };
    const promise = writeChain.then(() => persist(sentDoc, entry.immediate));
    entry.promise = promise;
    pendingSaves.set(sentDoc, [...pending, entry]);
    writeChain = promise.catch(() => {});
    const settled = () => {
      const current = pendingSaves.get(sentDoc) ?? [];
      const remaining = current.filter((candidate) => candidate !== entry);
      if (remaining.length) pendingSaves.set(sentDoc, remaining);
      else pendingSaves.delete(sentDoc);
    };
    promise.then(settled, settled);
    return promise;
  };

  const save = (sentDoc: DesignerDoc) => {
    if (store.getState().gestureDepth > 0) return;
    enqueueSave(sentDoc, false).catch(() => scheduleRetry());
  };

  const saveNow = (sentDoc: DesignerDoc) => enqueueSave(sentDoc, true);

  return {
    save,
    saveNow,
    ensureCreated,
    createInFlight: () => createPromise,
  };
};
