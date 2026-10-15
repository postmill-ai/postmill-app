'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import type { DesignerDoc } from '../designer.store';
import { getThumbnailDataUrl } from '../designer';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import {
  ALL_CATEGORIES_KEY,
  groupTemplatesByCategory,
} from './template-categories';
import { SaveTemplateModal } from './save-template-modal';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface DesignTemplate {
  id: string;
  name: string;
  doc: DesignerDoc;
  isSystem: boolean;
  category?: string | null;
  thumbnail?: string;
}

interface TemplatesPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
  /** Resolves false to abort applying (unsaved-changes guard). */
  guard?: () => Promise<boolean>;
}

export const TemplatesPanel: FC<TemplatesPanelProps> = ({ store, onClose, guard }) => {
  const fetch = useFetch();
  const user = useUser();
  const toaster = useToaster();
  const modal = useModals();
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

  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_KEY);

  // Sections drive both the filter chips and the grouped grid; phase 2 turns
  // these into folders, so everything category-shaped funnels through here.
  const sections = useMemo(() => groupTemplatesByCategory(data ?? []), [data]);
  const visibleSections = useMemo(
    () =>
      activeCategory === ALL_CATEGORIES_KEY
        ? sections
        : sections.filter((section) => section.key === activeCategory),
    [sections, activeCategory]
  );
  const categoryLabels = useMemo(
    () => sections.map((s) => s.label).filter((label): label is string => !!label),
    [sections]
  );

  const applyTemplate = useCallback(async (template: DesignTemplate) => {
    if (guard && !(await guard())) return;
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

  const persistTemplate = useCallback(async (category: string): Promise<boolean> => {
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
        form.append('internal', 'design-preview');
        const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          thumbnailFileId = uploadData.id;
        }
      } catch {}
    }
    const payload: Record<string, unknown> = {
      name: `${name} (template)`,
      category,
      doc: state.doc,
    };
    if (thumbnailFileId) payload.thumbnailFileId = thumbnailFileId;
    // The thumbnail upload already minted a File row — if the template save
    // fails or aborts, that row is referenced by nothing and would orphan in
    // the library. Trash it (same endpoint the file manager uses).
    const trashOrphanThumbnail = () => {
      if (thumbnailFileId) {
        fetch(`/files/${thumbnailFileId}/trash`, { method: 'POST' }).catch(() => {});
      }
    };
    try {
      if (state.templateId) {
        const res = await fetch(`/media/design-templates/${state.templateId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          toaster.show(t('templates_panel_template_updated', 'Template updated'), 'success');
          mutate();
          return true;
        }
        trashOrphanThumbnail();
        toaster.show(t('templates_panel_failed_to_update_template', 'Failed to update template'), 'warning');
        return false;
      }
      const res = await fetch('/media/design-templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        state.setTemplateId(data.id);
        toaster.show(t('templates_panel_saved_as_template', 'Saved as template'), 'success');
        mutate();
        return true;
      }
      trashOrphanThumbnail();
      toaster.show(t('template_save_failed', 'Failed to save template'), 'warning');
      return false;
    } catch {
      trashOrphanThumbnail();
      toaster.show(t('template_save_failed', 'Failed to save template'), 'warning');
      return false;
    }
  }, [store, fetch, mutate, toaster, t]);

  const saveAsTemplate = useCallback(() => {
    const state = store.getState();
    // On update, pre-fill the template's current category; on first save keep
    // the historical default (current output format, else 'custom').
    const currentCategory = state.templateId
      ? data?.find((template) => template.id === state.templateId)?.category?.trim()
      : undefined;
    modal.openModal({
      title: state.templateId
        ? t('templates_panel_update_template', 'Update template')
        : t('templates_panel_save_as_template', 'Save as template'),
      size: 420,
      children: (close) => (
        <SaveTemplateModal
          isUpdate={!!state.templateId}
          defaultCategory={currentCategory || state.doc.outputs[0]?.formatId || 'custom'}
          categories={categoryLabels}
          onCancel={close}
          onSave={async (category) => {
            const saved = await persistTemplate(category);
            if (saved) close();
            return saved;
          }}
        />
      ),
    });
  }, [store, data, modal, categoryLabels, persistTemplate, t]);

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
        <>
          {sections.length > 1 && (
            <OverflowTabs
              items={[
                { key: ALL_CATEGORIES_KEY, label: t('all', 'All') },
                ...sections.map((section) => ({
                  key: section.key,
                  label: section.label ?? t('other', 'Other'),
                })),
              ]}
              activeKey={activeCategory}
              onSelect={setActiveCategory}
              variant="outline"
              semantics="toolbar"
              ariaLabel={t('templates_panel_more_categories', 'More categories')}
              listAriaLabel={t('templates_panel_filter_by_category', 'Filter by category')}
            />
          )}
          {visibleSections.length === 0 ? (
            <div className="text-[12px] text-newTextColor/60 text-center py-4">
              {t('templates_panel_no_templates_in_category', 'No templates in this category')}
            </div>
          ) : (
            visibleSections.map((section) => (
              <section key={section.key} className="flex flex-col gap-2">
                <h3 className="text-[11px] font-[600] uppercase tracking-wide text-newTextColor/60">
                  {section.label ?? t('other', 'Other')}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {section.templates.map((template) => (
                    <div
                      key={template.id}
                      className="rounded-lg border border-studioBorder bg-newBgColorInner overflow-hidden group"
                    >
                      <div className="aspect-4/3 bg-studioBorder/10 flex items-center justify-center text-[20px] text-newTextColor/20">
                        {template.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element -- server-rendered template thumbnail
                          <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" />
                        ) : (
                          template.isSystem ? '◧' : '▣'
                        )}
                      </div>
                      <div className="p-2">
                        <div className="text-[11px] text-textColor truncate">{template.name}</div>
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-[10px] text-newTextColor/60">
                            {template.isSystem ? t('system', 'System') : t('templates_panel_org', 'Org')}
                          </div>
                          <span className="px-1.5 py-0.5 rounded-full bg-btnPrimary/15 text-btnPrimaryAccent text-[9px] font-[500] truncate max-w-[90px]">
                            {template.category?.trim() || t('other', 'Other')}
                          </span>
                        </div>
                        <button
                          onClick={() => applyTemplate(template)}
                          className="mt-1 w-full px-2 py-1 rounded-sm text-[11px] bg-designerAccent text-white hover:bg-designerAccent/80"
                        >
                          {t('apply', 'Apply')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
};
