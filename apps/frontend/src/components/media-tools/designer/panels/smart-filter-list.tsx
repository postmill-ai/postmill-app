'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  EyeIcon,
  EyeOffIcon,
} from '@postmill-ai/frontend/components/ui/icons/designer-tools';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import {
  defaultFilterParams,
  filterById,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-descriptors';
import type { FilterParams } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-ops';
import { FilterDialog } from '../filter-dialog';
import {
  removeSmartFilter,
  reorderSmartFilter,
  toggleSmartFilter,
  updateSmartFilterParams,
} from '../smart-filters';
import type { DesignerElement } from '../designer.store';

/**
 * A layer's non-destructive filter stack, listed under its row the way
 * Photoshop lists Smart Filters.
 *
 * Order is the effect — a blur then a posterize is not a posterize then a blur
 * — so reordering is a first-class control rather than a cosmetic one.
 */

interface SmartFilterListProps {
  /** The stack itself — layers and clips both carry one, so this takes neither. */
  stack: DesignerElement['smartFilters'];
  onChange: (next: DesignerElement['smartFilters']) => void;
  /** Indent, to line the list up under a nested layer row. */
  depth?: number;
}

export const SmartFilterList: FC<SmartFilterListProps> = ({
  stack,
  onChange,
  depth = 0,
}) => {
  const t = useT();
  const modals = useModals();
  if (!stack?.length) return null;

  const write = onChange;

  /** Retune an entry in place. The re-bake replays the whole stack after. */
  const edit = (index: number) => {
    const entry = stack[index];
    const descriptor = filterById(entry.id);
    if (!descriptor || !descriptor.params.length) return;
    modals.openModal({
      title: t(`designer_filter_${entry.id}`, descriptor.label),
      children: (close: () => void) => (
        <FilterDialog
          descriptor={descriptor}
          initial={{ ...defaultFilterParams(entry.id), ...(entry.params || {}) } as FilterParams}
          onCancel={close}
          onApply={(params) => {
            close();
            write(updateSmartFilterParams(stack, index, params));
          }}
        />
      ),
    });
  };

  return (
    <div
      data-testid="smart-filter-list"
      style={{ paddingInlineStart: 20 + depth * 12 }}
      className="pe-1.5 pb-1"
    >
      <div className="text-[10px] uppercase tracking-wider text-textColor/40 py-0.5">
        {t('designer_smart_filters', 'Smart Filters')}
      </div>
      {stack.map((entry, i) => {
        const descriptor = filterById(entry.id);
        const off = entry.enabled === false;
        return (
          <div
            key={`${entry.id}-${i}`}
            data-smart-filter={entry.id}
            className={`flex items-center gap-1 text-[11px] py-0.5 ${
              off ? 'text-textColor/35' : 'text-textColor/75'
            }`}
          >
            <button
              type="button"
              data-row-action
              aria-label={
                off
                  ? t('designer_enable_filter', 'Enable filter')
                  : t('designer_disable_filter', 'Disable filter')
              }
              onClick={(e) => {
                e.stopPropagation();
                write(toggleSmartFilter(stack, i));
              }}
              className="shrink-0 w-4 h-4 flex items-center justify-center text-textColor/55 hover:text-textColor"
            >
              {off ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
            </button>
            <button
              type="button"
              data-row-action
              disabled={!descriptor?.params.length}
              onClick={(e) => {
                e.stopPropagation();
                edit(i);
              }}
              title={t('designer_edit_filter', 'Edit filter settings')}
              className="flex-1 min-w-0 truncate text-start hover:text-textColor disabled:cursor-default"
            >
              {t(`designer_filter_${entry.id}`, descriptor?.label || entry.id)}
            </button>
            <button
              type="button"
              data-row-action
              aria-label={t('designer_move_filter_up', 'Move filter up')}
              disabled={i === 0}
              onClick={(e) => {
                e.stopPropagation();
                write(reorderSmartFilter(stack, i, i - 1));
              }}
              className="shrink-0 w-4 h-4 text-textColor/45 hover:text-textColor disabled:opacity-25"
            >
              ↑
            </button>
            <button
              type="button"
              data-row-action
              aria-label={t('designer_move_filter_down', 'Move filter down')}
              disabled={i === stack.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                write(reorderSmartFilter(stack, i, i + 1));
              }}
              className="shrink-0 w-4 h-4 text-textColor/45 hover:text-textColor disabled:opacity-25"
            >
              ↓
            </button>
            <button
              type="button"
              data-row-action
              aria-label={t('designer_remove_filter', 'Remove filter')}
              onClick={(e) => {
                e.stopPropagation();
                write(removeSmartFilter(stack, i));
              }}
              className="shrink-0 w-4 h-4 text-textColor/45 hover:text-red-400"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};
