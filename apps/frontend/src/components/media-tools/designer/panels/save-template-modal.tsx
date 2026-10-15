'use client';

import React, { FC, useState } from 'react';
import { Autocomplete, MantineProvider } from '@mantine/core';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface SaveTemplateModalProps {
  /** Update (PUT) vs first save (POST) — changes the copy only. */
  isUpdate: boolean;
  /** Pre-fill: the template's current category on update, else the current
   *  output's formatId (the pre-categories default). */
  defaultCategory: string;
  /** Category labels already in use, offered as autocomplete suggestions. */
  categories: string[];
  /** Resolves true when the save succeeded — the caller then closes the modal. */
  onSave: (category: string) => Promise<boolean>;
  onCancel: () => void;
}

export const SaveTemplateModal: FC<SaveTemplateModalProps> = ({
  isUpdate,
  defaultCategory,
  categories,
  onSave,
  onCancel,
}) => {
  const t = useT();
  const [category, setCategory] = useState(defaultCategory);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(category.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-[15px]">
      {/* Mantine 9 components throw outside a MantineProvider, and the app tree
          has none — scope one here (same pattern as launches/helpers/date.picker.tsx). */}
      <MantineProvider>
        <Autocomplete
          label={t('templates_panel_category_label', 'Category')}
          description={t(
            'templates_panel_category_hint',
            'Pick an existing category or type a new one'
          )}
          value={category}
          onChange={setCategory}
          data={categories}
          classNames={{
            label: 'text-[13px] font-[500] text-textColor mb-[4px]',
            description: 'text-[12px] text-newTextColor/60 mb-[6px]',
            input:
              'w-full h-[40px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] text-textColor outline-hidden focus:border-designerAccent',
          }}
        />
      </MantineProvider>
      <div className="flex justify-end gap-[10px]">
        <Button secondary onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button loading={saving} disabled={!category.trim()} onClick={handleSave}>
          {isUpdate
            ? t('templates_panel_update_template', 'Update template')
            : t('templates_panel_save_as_template', 'Save as template')}
        </Button>
      </div>
    </div>
  );
};
