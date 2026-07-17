'use client';

import React, { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import type { DesignerStore, DesignerDoc } from '../designer.store';
import { getThumbnailDataUrl } from '../designer';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface DesignTemplate {
  id: string;
  name: string;
  doc: DesignerDoc;
  isSystem: boolean;
  thumbnail?: string;
}

interface TemplatesPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
  /** Returns false to abort applying (unsaved-changes guard). */
  guard?: () => boolean;
}

export const TemplatesPanel: FC<TemplatesPanelProps> = ({ store, onClose, guard }) => {
  const fetch = useFetch();
  const user = useUser();
  const toaster = useToaster();
  const t = useT();

  const { data, error, isLoading, mutate } = useSWR(
    `design-templates-${user.orgId}`,
    async () => {
      const res = await fetch('/media/design-templates');
      if (!res.ok) throw new Error('Failed to load templates');
      return res.json() as Promise<DesignTemplate[]>;
    },
    { keepPreviousData: true }
  );

  const applyTemplate = useCallback(async (template: DesignTemplate) => {
    if (guard && !guard()) return;
    const res = await fetch('/media/designs', {
      method: 'POST',
      body: JSON.stringify({
        name: template.name,
        doc: template.doc,
      }),
    });
    if (!res.ok) {
      toaster.show(t('templates_panel_failed_to_create_from_template', 'Failed to create design from template'), 'warning');
      return;
    }
    const data = await res.json();
    store.getState().loadDesign(template.doc, data.id, template.name, template.id);
    onClose?.();
  }, [store, onClose, fetch, toaster, guard, t]);

  const saveAsTemplate = useCallback(async () => {
    const state = store.getState();
    const name = state.designName;
    const stageEl = document.querySelector('.konva-stage canvas') as HTMLCanvasElement;
    const previewDataUrl = getThumbnailDataUrl(stageEl);
    let thumbnailFileId: string | undefined;
    if (previewDataUrl) {
      try {
        const blob = await (await fetch(previewDataUrl)).blob();
        const form = new FormData();
        form.append('file', blob, 'thumbnail.jpg');
        const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          thumbnailFileId = uploadData.id;
        }
      } catch {}
    }
    const payload: Record<string, unknown> = {
      name: `${name} (template)`,
      category: state.doc.outputs[0]?.formatId || 'custom',
      doc: state.doc,
    };
    if (thumbnailFileId) payload.thumbnailFileId = thumbnailFileId;
    if (state.templateId) {
      const res = await fetch(`/media/design-templates/${state.templateId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toaster.show(t('templates_panel_template_updated', 'Template updated'), 'success');
        mutate();
      } else {
        toaster.show(t('templates_panel_failed_to_update_template', 'Failed to update template'), 'warning');
      }
    } else {
      const res = await fetch('/media/design-templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        state.setTemplateId(data.id);
        toaster.show(t('templates_panel_saved_as_template', 'Saved as template'), 'success');
        mutate();
      } else {
        toaster.show(t('template_save_failed', 'Failed to save template'), 'warning');
      }
    }
  }, [store, fetch, mutate, toaster, t]);

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={saveAsTemplate}
        className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
      >
        {t('templates_panel_save_current_as_template', 'Save current as template')}
      </button>

      {isLoading && !data ? (
        <PanelSkeletonGrid count={4} />
      ) : error && !data ? (
        (toaster.show(t('templates_panel_couldnt_load_templates', "Couldn't load templates"), 'warning'), <PanelError message={t('templates_panel_couldnt_load_templates', "Couldn't load templates")} onRetry={() => mutate()} />)
      ) : !data?.length ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-4">
          {t('templates_panel_no_templates_yet', 'No templates yet')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {data.map((template) => (
            <div
              key={template.id}
              className="rounded-lg border border-studioBorder bg-newBgColorInner overflow-hidden group"
            >
              <div className="aspect-[4/3] bg-studioBorder/10 flex items-center justify-center text-[20px] text-newTextColor/20">
                {template.isSystem ? '◧' : '▣'}
              </div>
              <div className="p-2">
                <div className="text-[11px] text-textColor truncate">{template.name}</div>
                <div className="text-[10px] text-newTextColor/60">
                  {template.isSystem ? t('system', 'System') : t('templates_panel_org', 'Org')}
                </div>
                <button
                  onClick={() => applyTemplate(template)}
                  className="mt-1 w-full px-2 py-1 rounded text-[11px] bg-designerAccent text-white hover:bg-designerAccent/80"
                >
                  {t('apply', 'Apply')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
