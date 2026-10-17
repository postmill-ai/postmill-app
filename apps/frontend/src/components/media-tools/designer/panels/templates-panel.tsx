'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useModals, useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import type { DesignerDoc } from '../designer.store';
import { getThumbnailDataUrl } from '../designer';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import {
  ALL_CATEGORIES_KEY,
  VIDEO_CATEGORY_KEY,
  VIDEO_CATEGORY_LABEL,
  groupTemplatesByCategory,
  type TemplateSection,
} from './template-categories';
import { needsModeConfirm, templateModeOf } from './template-mode';
import {
  UNFILED_FOLDER_KEY,
  filterTemplatesByFolder,
  unfiledTemplates,
  type FolderSelection,
} from './template-folders';
import { TemplateFolderTree, useTemplateFolders } from './template-folder-tree';
import { SaveTemplateModal } from './save-template-modal';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface DesignTemplate {
  id: string;
  name: string;
  /** List payloads carry only `{ mode }` (badge/bucketing/confirm); the full
   *  doc arrives with the per-template GET on apply. */
  doc: { mode?: 'image' | 'video' } | DesignerDoc;
  isSystem: boolean;
  category?: string | null;
  folderId?: string | null;
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
  const decision = useDecisionModal();
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

  const { data: folders, mutate: mutateFolders } = useTemplateFolders(user?.orgId);
  const [selection, setSelection] = useState<FolderSelection>(null);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_KEY);

  // Folders organize (org templates only); the phase-1 category sections and
  // filter chips then group/filter inside the current folder view.
  const folderTemplates = useMemo(
    () => filterTemplatesByFolder(data ?? [], selection),
    [data, selection]
  );
  const unfiledCount = useMemo(() => unfiledTemplates(data ?? []).length, [data]);

  // Sections drive both the filter chips and the grouped grid.
  const sections = useMemo(() => groupTemplatesByCategory(folderTemplates), [folderTemplates]);
  const visibleSections = useMemo(
    () =>
      activeCategory === ALL_CATEGORIES_KEY
        ? sections
        : sections.filter((section) => section.key === activeCategory),
    [sections, activeCategory]
  );
  // Category suggestions for the save modal stay global — picking a folder
  // shouldn't shrink the vocabulary of existing category names.
  const categoryLabels = useMemo(
    () =>
      groupTemplatesByCategory(data ?? [])
        .map((s) => s.label)
        .filter((label): label is string => !!label),
    [data]
  );

  const applyTemplate = useCallback(async (template: DesignTemplate) => {
    // The list is meta-only (doc carries just the mode) — fetch the full
    // template on apply to get its doc.
    const fullRes = await fetch(`/media/design-templates/${template.id}`);
    if (!fullRes.ok) {
      toaster.show(t('templates_panel_failed_to_create_from_template', 'Failed to create design from template'), 'warning');
      return;
    }
    const full = (await fullRes.json()) as DesignTemplate;
    // Cross-mode applies swap the whole doc (loadDesign takes the template's
    // mode), so they get their own confirm — which also covers the dirty
    // guard's "replaces your design" warning, hence the else-if. An empty
    // canvas converts without asking.
    if (needsModeConfirm(full, store.getState().doc)) {
      const target = templateModeOf(full);
      const ok = await decision.open({
        title:
          target === 'video'
            ? t('templates_panel_apply_video_template', 'Apply video template')
            : t('templates_panel_apply_image_template', 'Apply image template'),
        description:
          target === 'video'
            ? t('templates_panel_apply_video_template_confirm', 'This is a video template — applying it converts your design to video mode and replaces the current design.')
            : t('templates_panel_apply_image_template_confirm', 'This is an image template — applying it converts your design to image mode and replaces the current design.'),
        approveLabel: t('apply', 'Apply'),
      });
      if (!ok) return;
    } else if (guard && !(await guard())) return;
    const res = await fetch('/media/designs', {
      method: 'POST',
      body: JSON.stringify({
        name: full.name,
        doc: full.doc,
      }),
    });
    if (!res.ok) {
      toaster.show(t('templates_panel_failed_to_create_from_template', 'Failed to create design from template'), 'warning');
      return;
    }
    const data = await res.json();
    store.getState().loadDesign(full.doc as DesignerDoc, data.id, full.name, full.id);
    onClose?.();
  }, [store, onClose, fetch, toaster, guard, decision, t]);

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
        body: JSON.stringify(
          // Saving while a folder is selected files the new template there.
          selection && selection !== UNFILED_FOLDER_KEY
            ? { ...payload, folderId: selection }
            : payload
        ),
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
  }, [store, fetch, mutate, toaster, selection, t]);

  const saveAsTemplate = useCallback(() => {
    const state = store.getState();
    // On update, pre-fill the template's current category; on first save the
    // default is 'Video' for video docs, else the historical default (current
    // output format, else 'custom').
    const currentCategory = state.templateId
      ? data?.find((template) => template.id === state.templateId)?.category?.trim()
      : undefined;
    const fallbackCategory =
      state.doc.mode === 'video'
        ? VIDEO_CATEGORY_LABEL
        : state.doc.outputs[0]?.formatId || 'custom';
    modal.openModal({
      title: state.templateId
        ? t('templates_panel_update_template', 'Update template')
        : t('templates_panel_save_as_template', 'Save as template'),
      size: 420,
      children: (close) => (
        <SaveTemplateModal
          isUpdate={!!state.templateId}
          defaultCategory={currentCategory || fallbackCategory}
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

  // Section labels: the video bucket and the uncategorized bucket get
  // translated chrome labels; everything else is user/seed data shown as-is.
  const sectionLabel = useCallback(
    (section: TemplateSection<DesignTemplate>): string =>
      section.key === VIDEO_CATEGORY_KEY
        ? t('templates_panel_video_category', 'Video')
        : section.label ?? t('other', 'Other'),
    [t]
  );

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={saveAsTemplate}
        className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
      >
        {t('templates_panel_save_current_as_template', 'Save current as template')}
      </button>

      <TemplateFolderTree
        folders={folders ?? []}
        unfiledCount={unfiledCount}
        selection={selection}
        onSelect={setSelection}
        onRefresh={() => mutateFolders()}
        onTemplateMoved={() => mutate()}
      />

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
                  label: sectionLabel(section),
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
              {selection
                ? t('templates_panel_no_templates_in_folder', 'No templates in this folder')
                : t('templates_panel_no_templates_in_category', 'No templates in this category')}
            </div>
          ) : (
            visibleSections.map((section) => (
              <section key={section.key} className="flex flex-col gap-2">
                <h3 className="text-[11px] font-[600] uppercase tracking-wide text-newTextColor/60">
                  {sectionLabel(section)}
                </h3>
                <div className="grid grid-cols-2 gap-2" role="list">
                  {section.templates.map((template) => (
                    <div
                      key={template.id}
                      role="listitem"
                      className="rounded-lg border border-studioBorder bg-newBgColorInner overflow-hidden group"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={t('templates_panel_apply_template', 'Apply template {{name}}', { name: template.name })}
                        onClick={() => applyTemplate(template)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            applyTemplate(template);
                          }
                        }}
                        className="relative aspect-4/3 bg-studioBorder/10 flex items-center justify-center text-[20px] text-newTextColor/20 cursor-pointer hover:ring-2 hover:ring-designerAccent/60 focus-visible:ring-2 focus-visible:ring-designerAccent"
                      >
                        {template.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element -- server-rendered template thumbnail
                          <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" />
                        ) : (
                          template.isSystem ? '◧' : '▣'
                        )}
                        {templateModeOf(template) === 'video' && (
                          <span className="absolute top-1 start-1 px-1.5 py-0.5 rounded-full bg-newBgColorInner/80 text-btnPrimaryAccent text-[9px] font-[500] leading-none">
                            {t('templates_panel_video_badge', 'Video')}
                          </span>
                        )}
                        {!template.isSystem && (
                          // Drag handle — drop onto a folder row in the tree to
                          // file the template (system templates are not folder-able).
                          // Clicks/keys here must never bubble to the tile's
                          // apply action; starting a drag takes precedence.
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={t('templates_panel_drag_to_folder', 'Drag to a folder')}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', template.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="absolute top-1 end-1 px-1.5 py-0.5 rounded-sm bg-newBgColorInner/80 text-newTextColor/60 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-[11px] leading-none select-none"
                          >
                            ⠿
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <button
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="block w-full text-left text-[11px] text-textColor truncate cursor-pointer hover:underline"
                        >
                          {template.name}
                        </button>
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-[10px] text-newTextColor/60">
                            {template.isSystem ? t('system', 'System') : t('templates_panel_org', 'Org')}
                          </div>
                          <span className="px-1.5 py-0.5 rounded-full bg-btnPrimary/15 text-btnPrimaryAccent text-[9px] font-[500] truncate max-w-[90px]">
                            {template.category?.trim() ||
                              (templateModeOf(template) === 'video'
                                ? t('templates_panel_video_category', 'Video')
                                : t('other', 'Other'))}
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
