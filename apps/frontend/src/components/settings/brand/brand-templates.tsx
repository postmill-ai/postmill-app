'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useDebounce } from 'use-debounce';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { DesignPreviewImage } from '@postmill-ai/frontend/components/media-tools/designer/panels/design-preview-image';

const PAGE_LIMIT = 24;

export interface BrandTemplate {
  id: string;
  name: string;
  category?: string | null;
  isSystem: boolean;
  brandProfileId?: string | null;
  thumbnail?: string | null;
  doc?: { mode?: 'image' | 'video' };
}

export interface BrandTemplatePage {
  templates: BrandTemplate[];
  total: number;
  page: number;
  limit: number;
}

export const reconcileTemplatePages = (pages: BrandTemplatePage[] = []) => {
  const templates = new Map<string, BrandTemplate>();
  for (const page of pages) {
    for (const template of page.templates) {
      if (!template.isSystem) templates.set(template.id, template);
    }
  }
  return [...templates.values()];
};

export const BrandTemplates: FC<{ brandId: string; canEdit: boolean }> = ({ brandId, canEdit }) => {
  const t = useT();
  const [search, setSearch] = useState('');
  const [query] = useDebounce(search.trim(), 250);
  const normalizedQuery = query.trim();

  return (
    <section id="templates" className="scroll-mt-[80px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
      <div>
        <div className="text-[13px]">{t('brand_templates', 'Brand templates')}</div>
        <div className="text-[12px] text-newTableText">{t('brand_templates_hint', 'Templates assigned to this brand appear first in Brand Mode. Shared templates stay available in General Mode.')}</div>
      </div>
      <div className="max-w-[480px]">
        <Input
          name="brand-template-search"
          label={t('brand_template_search', 'Search templates')}
          placeholder={t('brand_template_search_placeholder', 'Search by name or category')}
          aria-label={t('brand_template_search', 'Search templates')}
          disableForm
          removeError
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <BrandTemplateResults
        key={`${brandId}:${normalizedQuery}`}
        brandId={brandId}
        canEdit={canEdit}
        query={normalizedQuery}
      />
    </section>
  );
};

const BrandTemplateResults: FC<{ brandId: string; canEdit: boolean; query: string }> = ({ brandId, canEdit, query }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  const getKey = useCallback((pageIndex: number, previousPage: BrandTemplatePage | null) => {
    if (previousPage && previousPage.templates.length === 0) return null;
    const params = new URLSearchParams({
      page: String(pageIndex + 1),
      limit: String(PAGE_LIMIT),
      scope: 'org',
      brandId,
    });
    if (query) params.set('query', query);
    return `/media/design-templates?${params.toString()}`;
  }, [brandId, query]);

  const {
    data,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<BrandTemplatePage>(getKey, async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load brand templates');
    return res.json() as Promise<BrandTemplatePage>;
  }, { revalidateOnFocus: false, revalidateFirstPage: false });

  const templates = useMemo(() => reconcileTemplatePages(data), [data]);
  const assigned = useMemo(
    () => templates.filter((template) => template.brandProfileId === brandId),
    [brandId, templates],
  );
  const available = useMemo(
    () => templates.filter((template) => template.brandProfileId !== brandId),
    [brandId, templates],
  );
  const lastPage = data?.[data.length - 1];
  const hasMore = !!lastPage &&
    lastPage.templates.length === PAGE_LIMIT &&
    size * PAGE_LIMIT < (data?.[0]?.total || 0);
  const loadingMore = isValidating && size > (data?.length || 0);

  const assignTemplate = useCallback(async (template: BrandTemplate, assign: boolean) => {
    if (!canEdit || pendingTemplateId) return;
    setPendingTemplateId(template.id);
    try {
      const res = await fetch(`/media/design-templates/${template.id}`, {
        method: 'PUT',
        body: JSON.stringify({ brandProfileId: assign ? brandId : null }),
      });
      if (!res.ok) {
        toaster.show(t('brand_template_assignment_failed', 'Failed to update brand template'), 'warning');
        return;
      }
      const brandProfileId = assign ? brandId : null;
      await mutate((pages) => pages?.map((page) => ({
        ...page,
        templates: page.templates.map((entry) => entry.id === template.id
          ? { ...entry, brandProfileId }
          : entry),
      })), { revalidate: false });
      await mutate();
      toaster.show(t('brand_template_updated', 'Brand template updated'), 'success');
    } catch {
      toaster.show(t('brand_template_assignment_failed', 'Failed to update brand template'), 'warning');
    } finally {
      setPendingTemplateId(null);
    }
  }, [brandId, canEdit, fetch, mutate, pendingTemplateId, t, toaster]);

  if (isLoading) {
    return <div className="text-[12px] text-newTableText" role="status">{t('loading', 'Loading...')}</div>;
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-start gap-[10px] rounded-[8px] border border-newTableBorder p-[16px]" role="alert">
        <div className="text-[12px] text-newTableText">{t('brand_templates_load_failed', 'Failed to load brand templates.')}</div>
        <Button secondary onClick={() => mutate()}>{t('try_again', 'Try again')}</Button>
      </div>
    );
  }

  return (
    <>
      {!templates.length && query ? (
        <div className="rounded-[8px] border border-newTableBorder p-[16px] text-[12px] text-newTableText">
          {t('brand_templates_no_search_results', 'No templates match “{{query}}”.', { query, interpolation: { escapeValue: false } })}
        </div>
      ) : (
        <>
          <TemplateSection
            title={t('brand_templates_assigned', 'Assigned to this brand')}
            empty={t('no_brand_templates', 'No templates assigned to this brand yet.')}
            templates={assigned}
            brandId={brandId}
            canEdit={canEdit}
            pendingTemplateId={pendingTemplateId}
            onAssignment={assignTemplate}
          />
          <TemplateSection
            title={t('brand_templates_available', 'Available templates')}
            empty={t('brand_templates_none_available', 'No available templates in this view.')}
            templates={available}
            brandId={brandId}
            canEdit={canEdit}
            pendingTemplateId={pendingTemplateId}
            onAssignment={assignTemplate}
          />
        </>
      )}
      {error && (
        <div className="text-[12px] text-dangerText" role="alert">
          {t('brand_templates_refresh_failed', 'Some template results could not be refreshed. Try again.')}
        </div>
      )}
      {hasMore && (
        <Button
          secondary
          loading={loadingMore}
          onClick={() => setSize((current) => current + 1)}
          className="self-start"
        >
          {t('templates_panel_load_more', 'Load more')}
        </Button>
      )}
    </>
  );
};

const TemplateSection: FC<{
  title: string;
  empty: string;
  templates: BrandTemplate[];
  brandId: string;
  canEdit: boolean;
  pendingTemplateId: string | null;
  onAssignment: (template: BrandTemplate, assign: boolean) => void;
}> = ({ title, empty, templates, brandId, canEdit, pendingTemplateId, onAssignment }) => (
  <div className="mb-[16px] flex flex-col gap-[10px] last:mb-0">
    <div className="text-[12px] font-[500] text-newTableText">{title}</div>
    {templates.length ? (
      <div role="list" aria-label={title} className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            assigned={template.brandProfileId === brandId}
            canEdit={canEdit}
            pending={pendingTemplateId === template.id}
            onAssignment={onAssignment}
          />
        ))}
      </div>
    ) : (
      <div className="rounded-[8px] border border-dashed border-newTableBorder p-[12px] text-[12px] text-newTableText">{empty}</div>
    )}
  </div>
);

const TemplateCard: FC<{
  template: BrandTemplate;
  assigned: boolean;
  canEdit: boolean;
  pending: boolean;
  onAssignment: (template: BrandTemplate, assign: boolean) => void;
}> = ({ template, assigned, canEdit, pending, onAssignment }) => {
  const t = useT();
  const mode = template.doc?.mode === 'video' ? 'video' : 'image';
  const action = assigned
    ? t('unassign_template', 'Unassign {{name}}', { name: template.name, interpolation: { escapeValue: false } })
    : t('assign_template', 'Assign {{name}}', { name: template.name, interpolation: { escapeValue: false } });

  return (
    <article role="listitem" data-template-id={template.id} className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-newTableBorder bg-newBgColor">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-newBgColorInner text-newTableText">
        <DesignPreviewImage
          src={template.thumbnail}
          alt={t('brand_template_preview', '{{name}} preview', { name: template.name, interpolation: { escapeValue: false } })}
          className="h-full w-full object-cover"
          draggable={false}
          fallback={(
            <div className="flex flex-col items-center gap-[6px] text-[12px]">
              <span aria-hidden="true">▣</span>
              <span>{t('brand_template_no_preview', 'No preview available')}</span>
            </div>
          )}
        />
        <span className="absolute start-[8px] top-[8px] rounded-full bg-newBgColorInner/90 px-[7px] py-[3px] text-[9px] font-[500] uppercase leading-none text-btnPrimaryAccent">
          {mode === 'video' ? t('templates_panel_video_badge', 'VIDEO') : t('templates_panel_image_badge', 'IMAGE')}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-[10px] p-[12px]">
        <div className="min-w-0">
          <div
            className="truncate text-[13px] text-textColor"
            title={template.name}
            data-tooltip-id="tooltip"
            data-tooltip-content={template.name}
          >
            {template.name}
          </div>
          <div className="truncate text-[11px] text-newTableText" title={template.category || undefined}>
            {template.category?.trim() || t('other', 'Other')}
          </div>
        </div>
        {canEdit && (
          <Button
            secondary={assigned}
            loading={pending}
            aria-label={action}
            title={action}
            onClick={() => onAssignment(template, !assigned)}
            className="mt-auto w-full shrink-0 px-[10px]"
          >
            {assigned ? t('unassign', 'Unassign') : t('assign', 'Assign')}
          </Button>
        )}
      </div>
    </article>
  );
};
