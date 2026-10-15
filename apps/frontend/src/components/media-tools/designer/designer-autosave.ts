import type { DesignerDoc, createDesignerStore } from './designer.store';

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

export interface DesignAutosave {
  /**
   * Debounced-doc entry point. First edit on a brand-new design POSTs it once
   * (there is no id for the PUT cycle yet); afterwards every call PUTs. A
   * pristine doc (not dirty) is never persisted.
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

  const ensureCreated = (): Promise<string> => {
    const existing = store.getState().designId;
    if (existing) return Promise.resolve(existing);
    if (createPromise) return createPromise;
    createPromise = (async () => {
      try {
        const s = store.getState();
        const sentDoc = s.doc;
        // Best-effort preview, identical fallback semantics to manual save:
        // upload wins, else base64, else nothing. A thumbnail failure must
        // never sink the create, so degrade to no preview.
        const { previewFileId, previewDataUrl } = await uploadPreview().catch(
          () => ({}) as PreviewUpload
        );
        const payload: Record<string, unknown> = {
          name: s.designName,
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
        // changes exist and must not be marked "Saved".
        if (store.getState().doc === sentDoc) {
          store.getState().markSaved();
        }
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
    const res = await fetchFn(`/media/designs/${designId}`, {
      method: 'PUT',
      body: JSON.stringify({ doc: sentDoc, ...preview }),
    });
    await res.json();
  };

  const save = (sentDoc: DesignerDoc) => {
    const state = store.getState();
    if (!state.isDirty) return;
    if (!state.designId) {
      // First-edit autosave. The brand-compliance check stays manual-save-only
      // — autosave never blocks on it. When the create lands its id in the
      // store, the debounced-doc effect re-fires and the PUT cycle takes over.
      state.setSaving(true);
      ensureCreated().catch(() => {
        store.getState().setSaving(false);
      });
      return;
    }
    const designId = state.designId;
    state.setSaving(true);
    putDoc(designId, sentDoc)
      .then(() => {
        // Only clear isDirty if no edit landed while the PUT was in flight.
        if (store.getState().doc === sentDoc) {
          store.getState().markSaved();
        } else {
          store.getState().setSaving(false);
        }
      })
      .catch(() => {
        store.getState().setSaving(false);
      });
  };

  return {
    save,
    ensureCreated,
    createInFlight: () => createPromise,
  };
};
