import type { DesignerDoc, createDesignerStore } from './designer.store';
import { isBlankDoc } from './designer-doc-blank';

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
  const unsubscribe = store.subscribe((state) => {
    const prevState = prev;
    prev = state;
    if (state.doc !== prevState.doc || state.designName !== prevState.designName) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const s = store.getState();
        if (s.isDirty) designAutosave.save(s.doc);
      }, debounceMs);
    } else if (state.designId !== prevState.designId && state.designId) {
      designAutosave.save(state.doc);
    }
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
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
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
  };

  /**
   * A failed autosave used to end at setSaving(false) — silent data loss the
   * header read as "Unsaved" forever. Surface it (`saveFailed`, the header's
   * pill) and retry with exponential backoff until a write lands.
   */
  const scheduleRetry = () => {
    store.getState().setSaveFailed(true);
    if (retryTimer) return;
    const delay = Math.min(30000, 2000 * 2 ** retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const s = store.getState();
      if (!s.isDirty) {
        s.setSaveFailed(false);
        retryAttempt = 0;
        return;
      }
      save(s.doc);
    }, delay);
  };

  const notePersisted = () => {
    clearRetry();
    store.getState().setSaveFailed(false);
  };

  const ensureCreated = (): Promise<string> => {
    const existing = store.getState().designId;
    if (existing) return Promise.resolve(existing);
    if (createPromise) return createPromise;
    createPromise = (async () => {
      try {
        const s = store.getState();
        const sentDoc = s.doc;
        const sentName = s.designName;
        // Best-effort preview, identical fallback semantics to manual save:
        // upload wins, else base64, else nothing. A thumbnail failure must
        // never sink the create, so degrade to no preview.
        const { previewFileId, previewDataUrl } = await uploadPreview().catch(
          () => ({}) as PreviewUpload
        );
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
        const res = await fetchFn('/media/designs', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Autosave create failed');
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
          after.markSaved();
        }
        notePersisted();
        return data.id as string;
      } finally {
        createPromise = null;
      }
    })();
    return createPromise;
  };

  const putDoc = async (designId: string, sentDoc: DesignerDoc) => {
    // Check staleness BEFORE uploading: the PUT below omits preview fields
    // for a stale doc, so a thumbnail uploaded for one would orphan its
    // File row in the library (backend cleanup only deletes REPLACED
    // referenced previews).
    let preview: PreviewUpload = {};
    if (store.getState().doc === sentDoc) {
      preview = await uploadPreview();
      // Re-check after the upload: an edit landed mid-flight, so the PUT
      // must not carry the stale thumbnail — and the just-created File row
      // would orphan, so trash it (same endpoint the file manager uses).
      if (store.getState().doc !== sentDoc) {
        if (preview.previewFileId) {
          fetchFn(`/files/${preview.previewFileId}/trash`, { method: 'POST' }).catch(() => {});
        }
        preview = {};
      }
    }
    // Read the name at send time, not at schedule time: a rename that landed
    // while the preview uploaded must ride along, or the library name would
    // lag the header (and a later markSaved would bury it — see save()).
    const sentName = store.getState().designName;
    const res = await fetchFn(`/media/designs/${designId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: sentName, doc: sentDoc, ...preview }),
    });
    await res.json();
    return sentName;
  };

  const save = (sentDoc: DesignerDoc) => {
    const state = store.getState();
    if (!state.isDirty) return;
    // Never mint a design row for an untouched canvas: with no designId yet a
    // save would POST a create, so a dirty-but-blank doc (e.g. a rename of a
    // canvas the user never drew on) is skipped. An existing design is
    // unaffected — deleting all content must still persist.
    if (!state.designId && isBlankDoc(sentDoc)) return;
    if (!state.designId) {
      // First-edit autosave. The brand-compliance check stays manual-save-only
      // — autosave never blocks on it. When the create lands its id in the
      // store, the debounced-doc effect re-fires and the PUT cycle takes over.
      state.setSaving(true);
      ensureCreated().catch(() => {
        store.getState().setSaving(false);
        scheduleRetry();
      });
      return;
    }
    const designId = state.designId;
    state.setSaving(true);
    putDoc(designId, sentDoc)
      .then((sentName) => {
        // Only clear isDirty when neither the doc nor the name moved on while
        // the PUT was in flight — it persisted exactly those two snapshots. A
        // mid-flight rename keeps the design dirty so the debounced effect
        // (which also watches the name) re-fires and persists it.
        const s = store.getState();
        if (s.doc === sentDoc && s.designName === sentName) {
          s.markSaved();
        } else {
          s.setSaving(false);
        }
        notePersisted();
      })
      .catch(() => {
        store.getState().setSaving(false);
        scheduleRetry();
      });
  };

  return {
    save,
    ensureCreated,
    createInFlight: () => createPromise,
  };
};
