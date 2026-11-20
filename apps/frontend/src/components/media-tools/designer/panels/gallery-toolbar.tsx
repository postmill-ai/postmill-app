'use client';

import React, { FC } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { Select } from '@postmill-ai/react/form/select';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerGallerySort } from '@postmill-ai/nestjs-libraries/media/designer-doc/template-category';
import type { DesignerGallerySize } from './gallery-preferences';

export const DesignerGalleryToolbar: FC<{
  search: string;
  onSearchChange: (value: string) => void;
  sort: DesignerGallerySort;
  onSortChange: (value: DesignerGallerySort) => void;
  size: DesignerGallerySize;
  onSizeChange: (value: DesignerGallerySize) => void;
  searchLabel: string;
  searchPlaceholder: string;
}> = ({
  search,
  onSearchChange,
  sort,
  onSortChange,
  size,
  onSizeChange,
  searchLabel,
  searchPlaceholder,
}) => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-[8px]" data-gallery-toolbar>
      <div className="min-w-[180px] flex-1">
        <Input
          name="designer-gallery-search"
          label=""
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          disableForm
          removeError
          className="h-[36px] bg-newBgColor"
        />
      </div>
      <Select
        name="designer-gallery-sort"
        label=""
        aria-label={t('sort_by', 'Sort by')}
        value={sort}
        onChange={(event) => onSortChange(event.target.value as DesignerGallerySort)}
        disableForm
        hideErrors
        className="h-[36px] min-w-[142px] bg-newBgColor px-[10px] text-[12px]"
      >
        <option value="newest">{t('gallery_sort_newest', 'Newest')}</option>
        <option value="name">{t('gallery_sort_name', 'Name')}</option>
        <option value="recent">{t('gallery_sort_recently_opened', 'Recently opened')}</option>
      </Select>
      <div className="flex items-center gap-[4px]" role="group" aria-label={t('gallery_card_size', 'Card size')}>
        <span className="me-[3px] text-[11px] text-newTableText">{t('gallery_size', 'Size:')}</span>
        {(['s', 'm', 'l'] as const).map((value) => (
          <Button
            key={value}
            secondary={size !== value}
            aria-pressed={size === value}
            aria-label={t('gallery_size_value', 'Size {{size}}', { size: value.toUpperCase() })}
            onClick={() => onSizeChange(value)}
            className="h-[30px] w-[32px] px-0 text-[11px]"
          >
            {value.toUpperCase()}
          </Button>
        ))}
      </div>
    </div>
  );
};
