'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { PanelSkeletonGrid, PanelError } from './panel-states';

/**
 * Version history (server-persisted, unlike the in-memory History panel).
 *
 * Lists the design's DesignVersion rows (metadata only — the doc stays on the
 * server until restore). Restore is non-destructive twice over: the server
 * snapshots the live doc as an `auto` version before overwriting, and the
 * restored doc lands in the store as a NEW history entry (undoable in-session)
 * rather than a loadDesign reset — so an active collab session picks it up
 * through the normal store → Yjs sync.
 */

interface DesignVersionMeta {
  id: string;
  name?: string | null;
  auto: boolean;
  width: number;
  height: number;
  previewDataUrl?: string | null;
  createdAt: string;
}

interface VersionsPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
}

export const VersionsPanel: FC<VersionsPanelProps> = ({ store }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const decision = useDecisionModal();
  const designId = store((s) => s.designId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    designId ? `design-versions-${designId}` : null,
    async () => {
      const res = await fetch(`/media/designs/${designId}/versions`);
      if (!res.ok) throw new Error('Failed to load versions');
      return res.json() as Promise<DesignVersionMeta[]>;
    },
    { keepPreviousData: true }
  );

  const handleRestore = useCallback(
    async (version: DesignVersionMeta) => {
      const approved = await decision.open({
        title: t('designer_restore_version_title', 'Restore this version?'),
        description: t(
          'designer_restore_version_confirm',
          'The current design is saved as an automatic safety snapshot first, so you can undo this later.'
        ),
        approveLabel: t('designer_restore_version', 'Restore'),
        cancelLabel: t('cancel', 'Cancel'),
      });
      if (!approved || !designId) return;
      setBusyId(version.id);
      try {
        // The server takes the safety snapshot and overwrites the design doc;
        // the response is the updated design.
        const res = await fetch(`/media/designs/${designId}/versions/${version.id}/restore`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('restore failed');
        const updated = await res.json();
        // New history entry (undoable in-session), NOT loadDesign: a store
        // reset would wipe the undo stack and bypass the collab Yjs sync,
        // which watches store doc changes.
        store.getState().setDoc(updated.doc);
        store.getState().pushHistory('Restore version');
        toaster.show(t('designer_version_restored', 'Version restored'), 'success');
        mutate();
      } catch {
        toaster.show(t('designer_restore_failed', 'Failed to restore version'), 'warning');
      } finally {
        setBusyId(null);
      }
    },
    [decision, designId, fetch, store, toaster, t, mutate]
  );

  const handleDelete = useCallback(
    async (version: DesignVersionMeta) => {
      const approved = await decision.open({
        title: t('designer_delete_version_title', 'Delete version?'),
        description: t(
          'designer_delete_version_confirm',
          'This version snapshot will be permanently deleted.'
        ),
        approveLabel: t('delete', 'Delete'),
        cancelLabel: t('cancel', 'Cancel'),
      });
      if (!approved || !designId) return;
      setBusyId(version.id);
      try {
        await fetch(`/media/designs/${designId}/versions/${version.id}`, { method: 'DELETE' });
        mutate();
      } finally {
        setBusyId(null);
      }
    },
    [decision, designId, fetch, mutate, t]
  );

  if (!designId) {
    return (
      <div className="p-4 text-[12px] text-newTextColor/60 text-center">
        {t('designer_save_version_first', 'Save the design first to keep versions')}
      </div>
    );
  }

  if (isLoading && !data) {
    return <PanelSkeletonGrid count={4} columnsClassName="grid-cols-1" aspectClassName="aspect-video" />;
  }

  if (error && !data) {
    return (
      <PanelError
        message={t('designer_versions_failed', 'Failed to load versions')}
        onRetry={() => mutate()}
      />
    );
  }

  const versions: DesignVersionMeta[] = data || [];

  return (
    <div className="flex flex-col max-h-[360px] overflow-y-auto p-2 gap-1" role="list" aria-label={t('designer_versions', 'Versions')}>
      {versions.length === 0 && (
        <div className="text-[12px] text-newTextColor/60 text-center py-6">
          {t('designer_no_versions', 'No versions yet. Use File ▸ Save Version… to snapshot this design.')}
        </div>
      )}
      {versions.map((v) => (
        <div
          key={v.id}
          role="listitem"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-studioBorder/50 hover:bg-studioBorder/10"
        >
          {v.previewDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL snapshot
            <img src={v.previewDataUrl} alt="" className="w-10 h-10 rounded-sm object-cover shrink-0 bg-white" />
          ) : (
            <div className="w-10 h-10 rounded-sm bg-studioBorder/20 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-textColor truncate">
              {v.name ||
                t('designer_version_untitled', 'Version {{date}}', {
                  date: new Date(v.createdAt).toLocaleString(),
                })}
            </div>
            <div className="text-[10px] text-newTextColor/60">
              {new Date(v.createdAt).toLocaleString()} · {v.width}×{v.height}
              {v.auto && (
                <span className="ml-1 px-1 rounded-sm bg-studioBorder/30 text-[9px] uppercase tracking-wide">
                  {t('designer_version_auto', 'Auto')}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={busyId === v.id}
            onClick={() => handleRestore(v)}
            className="px-2 py-1 rounded-sm text-[11px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50 shrink-0"
          >
            {t('designer_restore_version', 'Restore')}
          </button>
          <button
            type="button"
            disabled={busyId === v.id}
            onClick={() => handleDelete(v)}
            aria-label={t('designer_delete_version_title', 'Delete version?')}
            className="w-6 h-6 flex items-center justify-center rounded-sm text-[11px] text-dangerText hover:bg-red-500/20 disabled:opacity-50 shrink-0"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

/**
 * The File ▸ Save Version… dialog: optional name + the stage thumbnail as the
 * version's preview. Ensures the design exists first (unsaved designs have no
 * id to hang a version on) by running the normal save flow.
 */
export const SaveVersionDialog: FC<{
  store: VersionsPanelProps['store'];
  onClose: () => void;
  saveDesign: () => Promise<void>;
}> = ({ store, onClose, saveDesign }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // A first save mints the design id; versions attach to it.
      await saveDesign();
      const designId = store.getState().designId;
      if (!designId) throw new Error('no design');
      const res = await fetch(`/media/designs/${designId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error('save failed');
      toaster.show(t('designer_version_saved', 'Version saved'), 'success');
      onClose();
    } catch {
      toaster.show(t('designer_version_save_failed', 'Failed to save version'), 'warning');
    } finally {
      setSaving(false);
    }
  }, [saveDesign, store, fetch, name, toaster, t, onClose]);

  return (
    <div className="flex flex-col gap-3 w-[320px] max-w-full">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
        placeholder={t('designer_version_name_placeholder', 'Version name (optional)')}
        aria-label={t('designer_version_name_placeholder', 'Version name (optional)')}
        className="h-9 rounded-md border border-studioBorder bg-newBgColor px-3 text-[13px] text-textColor outline-hidden focus:border-designerAccent"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="px-3 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50"
        >
          {t('designer_save_version', 'Save Version')}
        </button>
      </div>
    </div>
  );
};

export default VersionsPanel;
