'use client';

import React, { FC } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useMediaPicker } from '../use-media-picker';
import { CHARACTER_REFERENCE_LIMIT, type CharacterReference } from './character-references';

export const CharacterReferenceTray: FC<{
  value: CharacterReference[];
  onChange: (references: CharacterReference[]) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const toaster = useToaster();
  const picker = useMediaPicker({
    title: t('designer_character_reference_picker', 'Choose character reference images'),
    kinds: ['image'],
    multiple: true,
    requireFile: true,
    onConfirm: (items) => {
      if (items.length > CHARACTER_REFERENCE_LIMIT) {
        toaster.show(
          t('designer_character_reference_limit', 'Choose up to {{count}} reference images.', {
            count: CHARACTER_REFERENCE_LIMIT,
          }),
          'warning'
        );
        return;
      }
      onChange(
        items.map((item) => ({
          fileId: item.fileId!,
          src: item.url,
          name: item.name,
        }))
      );
    },
  });

  return (
    <section className="flex flex-col gap-2 rounded-sm border border-studioBorder p-2" aria-label={t('designer_character_references', 'Character references')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-[600] text-textColor">
          {t('designer_character_references', 'Character references')}
        </span>
        <span className="text-[10px] text-newTextColor/60">{value.length}/{CHARACTER_REFERENCE_LIMIT}</span>
      </div>
      <p className="text-[10px] text-newTextColor/60">
        {t(
          'designer_character_reference_help',
          'Reuse the same person, character, or product across scenes. Applied automatically to supported models; continuity is not guaranteed.'
        )}
      </p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((reference, index) => (
            <li key={reference.fileId} className="relative">
              <img
                src={reference.src}
                alt={reference.name || t('designer_character_reference_image', 'Character reference {{index}}', { index: index + 1 })}
                className="h-14 w-14 rounded-sm border border-studioBorder object-cover"
              />
              <Button
                secondary
                className="absolute -end-1 -top-1 !h-5 !w-5 !min-w-5 !rounded-full !p-0"
                onClick={() => onChange(value.filter((item) => item.fileId !== reference.fileId))}
                aria-label={t('designer_remove_character_reference', 'Remove {{name}}', {
                  name: reference.name || t('designer_character_reference_image', 'Character reference {{index}}', { index: index + 1 }),
                })}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button secondary onClick={picker.open} className="self-start !px-2 !py-1 !text-[11px]">
        {value.length
          ? t('designer_change_character_references', 'Change reference images')
          : t('designer_add_character_references', 'Add reference images')}
      </Button>
      {picker.element}
    </section>
  );
};
