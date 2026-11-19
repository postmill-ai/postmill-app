'use client';

import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useDebounce } from 'use-debounce';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useModals, useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { Button } from '@postmill-ai/react/form/button';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { ContextMenu } from '@postmill-ai/frontend/components/ui/context-menu';
import { useContextMenu } from '@postmill-ai/frontend/components/ui/use-context-menu';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  DesignerGallerySort,
  templateCategoryKey,
  templateCategoryLabel,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/template-category';
import type { DesignerDoc } from '../designer.store';
import { captureStageThumbnail } from '../stage-thumbnail';
import { readErrorMessage } from '../read-error-message';
import { useBrandKit } from '../brand-kit-context';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { DesignPreviewImage } from './design-preview-image';
import { ALL_CATEGORIES_KEY, groupTemplatesByCategory } from './template-categories';
import { needsModeConfirm, templateModeOf } from './template-mode';
import { UNFILED_FOLDER_KEY, type FolderSelection } from './template-folders';
import { TemplateFolderTree, useTemplateFolders } from './template-folder-tree';
import { MoveTemplateModal } from './move-template-modal';
import { SaveTemplateModal } from './save-template-modal';
import { DesignerGalleryToolbar } from './gallery-toolbar';
import { designerGalleryGridStyle, useDesignerGallerySize } from './gallery-preferences';
import { GalleryCardActions, GalleryPreviewFallback } from './gallery-card';

export interface DesignTemplate {
  id: string;
  name: string;
  doc: { mode?: 'image' | 'video' } | DesignerDoc;
  isSystem: boolean;
  category?: string | null;
  folderId?: string | null;
  brandProfileId?: string | null;
  thumbnail?: string;
  createdAt?: string;
}

export interface TemplatePage {
  templates: DesignTemplate[];
  total: number;
  page: number;
  limit: number;
  categories?: { key: string; label: string }[];
  unfiledCount?: number;
}

const PAGE_LIMIT = 24;

export const TemplatesPanel: FC<{
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
  guard?: () => Promise<boolean>;
  showSaveCurrent?: boolean;
}> = ({ store, onClose, guard, showSaveCurrent = true }) => {
  const fetch = useFetch();
  const user = useUser();
  const toaster = useToaster();
  const modal = useModals();
  const decision = useDecisionModal();
  const t = useT();
  const { activeBrand } = useBrandKit();
  const [search, setSearch] = useState('');
  const [query] = useDebounce(search.trim(), 250);
  const [sort, setSort] = useState<DesignerGallerySort>('newest');
  const { size, setSize } = useDesignerGallerySize(user.orgId);
  const [selection, setSelection] = useState<FolderSelection>(null);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES_KEY);
  const { data: folders, mutate: mutateFolders } = useTemplateFolders(user?.orgId);
  const { menu: cardMenu, openAt: openCardMenu, close: closeCardMenu } = useContextMenu<DesignTemplate>();

  const getKey = useCallback((pageIndex: number, previousPage: TemplatePage | null) => {
    if (previousPage && previousPage.templates.length === 0) return null;
    const params = new URLSearchParams({
      page: String(pageIndex + 1),
      limit: String(PAGE_LIMIT),
      sort,
    });
    if (activeBrand) params.set('brandId', activeBrand.id);
    if (query) params.set('query', query);
    if (selection) params.set('folderId', selection === UNFILED_FOLDER_KEY ? 'none' : selection);
    if (activeCategory !== ALL_CATEGORIES_KEY) params.set('category', activeCategory);
    return `/media/design-templates?${params.toString()}`;
  }, [activeBrand, activeCategory, query, selection, sort]);
  const { data, error, isLoading, isValidating, size: pageCount, setSize: setPageCount, mutate } =
    useSWRInfinite<TemplatePage>(getKey, async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load templates');
      return res.json() as Promise<TemplatePage>;
    }, { revalidateOnFocus: false, revalidateFirstPage: true });

  const templates = useMemo(() => {
    const byId = new Map<string, DesignTemplate>();
    for (const page of data || []) {
      for (const template of page.templates) byId.set(template.id, template);
    }
    return [...byId.values()];
  }, [data]);
  const lastPage = data?.[data.length - 1];
  const hasMore = !!lastPage && lastPage.templates.length === PAGE_LIMIT &&
    pageCount * PAGE_LIMIT < (data?.[0]?.total || 0);
  const loadingMore = isValidating && pageCount > (data?.length || 0);
  const categories = useMemo(() => {
    const fromServer = data?.[0]?.categories;
    if (fromServer) return fromServer;
    return groupTemplatesByCategory(templates).map((section) => ({
      key: section.key,
      label: section.label || 'Other',
    }));
  }, [data, templates]);
  const categoryLabels = useMemo(
    () => categories.map((category) => category.label).filter(Boolean),
    [categories],
  );

  const refreshTemplates = useCallback(() => {
    setPageCount(1);
    void mutate();
  }, [mutate, setPageCount]);

  const systemCantBeFiled = useCallback(() => {
    toaster.show(t('templates_panel_system_cant_be_filed', "System templates can't be filed"), 'warning');
  }, [toaster, t]);

  const moveTemplateToFolder = useCallback(async (template: DesignTemplate, folderId: string | null): Promise<boolean> => {
    const res = await fetch(`/media/design-templates/${template.id}/move`, {
      method: 'PUT',
      body: JSON.stringify({ folderId }),
    });
    if (!res.ok) {
      toaster.show(await readErrorMessage(res, t('template_folder_move_failed', 'Failed to move template')), 'warning');
      return false;
    }
    toaster.show(t('template_folder_moved', 'Template moved'), 'success');
    refreshTemplates();
    void mutateFolders();
    return true;
  }, [fetch, toaster, refreshTemplates, mutateFolders, t]);

  const openMoveToFolder = useCallback((template: DesignTemplate) => {
    if (template.isSystem) {
      systemCantBeFiled();
      return;
    }
    modal.openModal({
      title: t('templates_panel_move_to_folder', 'Move to folder'),
      size: 420,
      children: (close) => (
        <MoveTemplateModal
          templateName={template.name}
          folders={folders ?? []}
          currentFolderId={template.folderId}
          onCancel={close}
          onMove={async (folderId) => {
            const moved = await moveTemplateToFolder(template, folderId);
            if (moved) close();
            return moved;
          }}
        />
      ),
    });
  }, [modal, folders, moveTemplateToFolder, systemCantBeFiled, t]);

  const previewTemplate = useCallback((template: DesignTemplate) => {
    modal.openModal({
      title: template.name,
      size: 900,
      children: (
        <div className="w-full min-w-0 overflow-hidden rounded-[8px] border border-studioBorder bg-studioBorder/10">
          <DesignPreviewImage
            src={template.thumbnail}
            alt={t('gallery_template_preview', '{{name}} preview', { name: template.name, interpolation: { escapeValue: false } })}
            className="max-h-[70vh] w-full object-contain"
            fallback={<GalleryPreviewFallback className="aspect-[16/9]" />}
          />
        </div>
      ),
    });
  }, [modal, t]);

  const applyTemplate = useCallback(async (template: DesignTemplate) => {
    const fullRes = await fetch(`/media/design-templates/${template.id}`);
    if (!fullRes.ok) {
      toaster.show(t('templates_panel_failed_to_create_from_template', 'Failed to create design from template'), 'warning');
      return;
    }
    const full = (await fullRes.json()) as DesignTemplate;
    if (needsModeConfirm(full, store.getState().doc)) {
      const target = templateModeOf(full);
      const ok = await decision.open({
        title: target === 'video'
          ? t('templates_panel_apply_video_template', 'Apply video template')
          : t('templates_panel_apply_image_template', 'Apply image template'),
        description: target === 'video'
          ? t('templates_panel_apply_video_template_confirm', 'This is a video template — applying it converts your design to video mode and replaces the current design.')
          : t('templates_panel_apply_image_template_confirm', 'This is an image template — applying it converts your design to image mode and replaces the current design.'),
        approveLabel: t('apply', 'Apply'),
      });
      if (!ok) return;
    } else if (guard && !(await guard())) return;
    const doc = {
      ...full.doc,
      brandProfileId: full.brandProfileId ?? store.getState().doc.brandProfileId ?? activeBrand?.id ?? null,
    } as DesignerDoc;
    const res = await fetch('/media/designs', {
      method: 'POST',
      body: JSON.stringify({ name: full.name, doc, sourceTemplateId: template.id }),
    });
    if (!res.ok) {
      toaster.show(t('templates_panel_failed_to_create_from_template', 'Failed to create design from template'), 'warning');
      return;
    }
    const created = await res.json();
    store.getState().loadDesign(doc, created.id, full.name, full.id);
    await mutate();
    onClose?.();
  }, [activeBrand?.id, store, onClose, fetch, toaster, guard, decision, t, mutate]);

  const persistTemplate = useCallback(async (category: string): Promise<boolean> => {
    const state = store.getState();
    const name = state.designName;
    const previewDataUrl = state.doc.mode === 'image' ? captureStageThumbnail() : undefined;
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
      brandProfileId: activeBrand?.id || null,
    };
    if (thumbnailFileId) payload.thumbnailFileId = thumbnailFileId;
    const trashOrphanThumbnail = () => {
      if (thumbnailFileId) void fetch(`/files/${thumbnailFileId}/trash`, { method: 'POST' }).catch(() => {});
    };
    try {
      if (state.templateId) {
        const res = await fetch(`/media/design-templates/${state.templateId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          toaster.show(t('templates_panel_template_updated', 'Template updated'), 'success');
          refreshTemplates();
          return true;
        }
        trashOrphanThumbnail();
        toaster.show(t('templates_panel_failed_to_update_template', 'Failed to update template'), 'warning');
        return false;
      }
      const res = await fetch('/media/design-templates', {
        method: 'POST',
        body: JSON.stringify(
          selection && selection !== UNFILED_FOLDER_KEY ? { ...payload, folderId: selection } : payload,
        ),
      });
      if (res.ok) {
        const created = await res.json();
        state.setTemplateId(created.id);
        toaster.show(t('templates_panel_saved_as_template', 'Saved as template'), 'success');
        refreshTemplates();
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
  }, [activeBrand?.id, store, fetch, refreshTemplates, toaster, selection, t]);

  const saveAsTemplate = useCallback(() => {
    const state = store.getState();
    const currentCategory = state.templateId
      ? templates.find((template) => template.id === state.templateId)?.category?.trim()
      : undefined;
    const fallbackCategory = state.doc.mode === 'video'
      ? 'Video'
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
  }, [store, templates, modal, categoryLabels, persistTemplate, t]);

  const translatedCategory = useCallback((key: string, label: string) => {
    if (key === 'video') return t('templates_panel_video_category', 'Video');
    if (key === 'custom') return t('templates_panel_custom_category', 'Custom');
    if (key === 'ig-post') return t('templates_panel_ig_post_category', 'IG Post');
    if (key === 'other') return t('other', 'Other');
    return label;
  }, [t]);

  return (
    <div className="flex flex-col gap-[12px]">
      {showSaveCurrent && (
        <Button onClick={saveAsTemplate} className="self-start">
          {t('templates_panel_save_current_as_template', 'Save current as template')}
        </Button>
      )}
      <TemplateFolderTree
        folders={folders ?? []}
        unfiledCount={data?.[0]?.unfiledCount || 0}
        selection={selection}
        onSelect={setSelection}
        onRefresh={() => mutateFolders()}
        onTemplateMoved={refreshTemplates}
      />
      <DesignerGalleryToolbar
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        size={size}
        onSizeChange={setSize}
        searchLabel={t('templates_panel_search', 'Search templates')}
        searchPlaceholder={t('templates_panel_search_placeholder', 'Search templates...')}
      />
      {isLoading && !data ? (
        <PanelSkeletonGrid count={10} columnsClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />
      ) : error && !data ? (
        <PanelError message={t('templates_panel_couldnt_load_templates', "Couldn't load templates")} onRetry={() => mutate()} />
      ) : (
        <>
          {categories.length > 0 && (
            <OverflowTabs
              items={[
                { key: ALL_CATEGORIES_KEY, label: t('all', 'All') },
                ...categories.map((category) => ({
                  key: category.key,
                  label: translatedCategory(category.key, category.label),
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
          {error && (
            <div role="alert" className="text-[12px] text-dangerText">
              {t('gallery_refresh_failed', 'Some results could not be refreshed. Try again.')}
            </div>
          )}
          {!templates.length ? (
            <div className="py-8 text-center text-[12px] text-newTextColor/60">
              {query
                ? t('templates_panel_no_search_results', 'No templates match “{{query}}”.', { query, interpolation: { escapeValue: false } })
                : selection
                  ? t('templates_panel_no_templates_in_folder', 'No templates in this folder')
                  : activeCategory !== ALL_CATEGORIES_KEY
                    ? t('templates_panel_no_templates_in_category', 'No templates in this category')
                    : t('templates_panel_no_templates_yet', 'No templates yet')}
            </div>
          ) : (
            <div className="grid gap-[10px]" style={designerGalleryGridStyle(size)} role="list">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onApply={applyTemplate}
                  onPreview={previewTemplate}
                  onSystemFileAttempt={systemCantBeFiled}
                  onMenu={openCardMenu}
                />
              ))}
            </div>
          )}
          {hasMore && (
            <Button secondary loading={loadingMore} onClick={() => setPageCount((current) => current + 1)} className="self-center">
              {t('templates_panel_load_more', 'Load more')}
            </Button>
          )}
        </>
      )}
      {cardMenu && (
        <ContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          onClose={closeCardMenu}
          ariaLabel={t('templates_panel_template_actions', 'Template actions')}
          items={[{
            label: t('templates_panel_move_to_folder_menu', 'Move to folder…'),
            onClick: () => openMoveToFolder(cardMenu.target),
          }]}
        />
      )}
    </div>
  );
};

const DRAG_THRESHOLD_PX = 5;

const TemplateCard: FC<{
  template: DesignTemplate;
  onApply: (template: DesignTemplate) => void;
  onPreview: (template: DesignTemplate) => void;
  onSystemFileAttempt: () => void;
  onMenu: (event: React.MouseEvent, template: DesignTemplate) => void;
}> = ({ template, onApply, onPreview, onSystemFileAttempt, onMenu }) => {
  const t = useT();
  const [dragArmed, setDragArmed] = useState(false);
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  const justDragged = useRef(false);
  const disarmDrag = useCallback(() => {
    pressPos.current = null;
    setDragArmed(false);
  }, []);
  const category = templateCategoryLabel(template.category, templateModeOf(template));

  return (
    <div
      role="listitem"
      data-template-id={template.id}
      draggable={dragArmed}
      onDragStart={(event) => {
        if (template.isSystem) {
          event.preventDefault();
          disarmDrag();
          onSystemFileAttempt();
          return;
        }
        event.dataTransfer.setData('text/plain', template.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        justDragged.current = true;
        disarmDrag();
      }}
      onPointerDown={(event) => {
        if (event.button === 0) {
          justDragged.current = false;
          pressPos.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onPointerMove={(event) => {
        const start = pressPos.current;
        if (start && !dragArmed && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD_PX) {
          setDragArmed(true);
        }
      }}
      onPointerUp={disarmDrag}
      onPointerCancel={() => { pressPos.current = null; }}
      onClickCapture={(event) => {
        if (justDragged.current) {
          justDragged.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => onMenu(event, template)}
      className="group min-w-0 select-none overflow-hidden rounded-[8px] border border-studioBorder bg-newBgColorInner transition-colors hover:border-designerAccent/60"
    >
      <div className="relative aspect-[4/3] bg-studioBorder/10">
        <DesignPreviewImage
          src={template.thumbnail}
          alt={t('gallery_template_preview', '{{name}} preview', { name: template.name, interpolation: { escapeValue: false } })}
          className="h-full w-full object-cover"
          draggable={false}
          fallback={<GalleryPreviewFallback />}
        />
        <span className="absolute start-[6px] top-[6px] rounded-full bg-newBgColorInner/90 px-[6px] py-[3px] text-[9px] font-[500] leading-none text-btnPrimaryAccent">
          {templateModeOf(template) === 'video'
            ? t('templates_panel_video_badge', 'VIDEO')
            : t('templates_panel_image_badge', 'IMAGE')}
        </span>
        {!template.isSystem && (
          <span aria-hidden="true" className="absolute end-[6px] top-[6px] rounded-sm bg-newBgColorInner/90 px-[5px] py-[3px] text-[11px] leading-none text-newTextColor/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            ⠿
          </span>
        )}
        <GalleryCardActions
          primaryLabel={t('apply', 'Apply')}
          primaryAriaLabel={t('templates_panel_apply_template', 'Apply template {{name}}', { name: template.name, interpolation: { escapeValue: false } })}
          onPrimary={() => onApply(template)}
          onPreview={() => onPreview(template)}
          previewAriaLabel={t('templates_panel_preview_template', 'Preview {{name}}', { name: template.name, interpolation: { escapeValue: false } })}
        />
      </div>
      <div className="p-[8px]">
        <div
          className="truncate text-[11px] font-[500] text-textColor"
          title={template.name}
          data-tooltip-id="tooltip"
          data-tooltip-content={template.name}
        >
          {template.name}
        </div>
        <div className="mt-[2px] truncate text-[10px] text-newTableText" title={template.category || category}>
          {translatedCardCategory(t, templateCategoryKey(template.category, templateModeOf(template)), category)}
          {template.isSystem ? ` · ${t('system', 'System')}` : ''}
        </div>
      </div>
    </div>
  );
};

const translatedCardCategory = (
  t: ReturnType<typeof useT>,
  key: string,
  fallback: string,
) => {
  if (key === 'video') return t('templates_panel_video_category', 'Video');
  if (key === 'custom') return t('templates_panel_custom_category', 'Custom');
  if (key === 'ig-post') return t('templates_panel_ig_post_category', 'IG Post');
  if (key === 'other') return t('other', 'Other');
  return fallback;
};
