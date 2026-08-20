'use client';

import React, { FC, useMemo } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ColorSwatch } from '../controls';
import { useMediaPicker } from '../../use-media-picker';
import {
  fillSlot,
  templateFields,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import type { DesignerOutput } from '../designer.store';

/**
 * The fill-in-the-blanks form a slotted template opens with.
 *
 * A template of thirty loose layers is a maze; the point of marking slots is
 * that opening it asks three questions instead. Nothing here can change
 * structure — a slot writes one property of one element.
 */

interface TemplateFillPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
}

export const TemplateFillPanel: FC<TemplateFillPanelProps> = ({ store }) => {
  const t = useT();
  const doc = store((s) => s.doc);
  const currentOutput = store((s) => s.currentOutput);
  const output = doc.outputs[currentOutput] as DesignerOutput | undefined;

  const fields = useMemo(
    () => templateFields(output?.children || []),
    [output?.children]
  );

  // `openWith` rather than a captured id: the per-open override is how this
  // hook is meant to carry which field asked, and it keeps the closure fresh.
  const picker = useMediaPicker({
    title: t('designer_choose_image', 'Choose an image'),
    kinds: ['image'],
  });

  const chooseImage = (elementId: string) =>
    picker.openWith({
      title: t('designer_choose_image', 'Choose an image'),
      kinds: ['image'],
      onSelect: (item) => {
        if (item.type !== 'image') return;
        store.getState().updateElement(elementId, { src: item.url, fileId: item.fileId });
        store.getState().pushHistory('Fill slot');
      },
    });

  if (!fields.length) {
    return (
      <p className="text-[11px] text-textColor/40 p-2">
        {t(
          'designer_no_template_slots',
          'Mark a layer as a template slot to fill it in from here.'
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2" data-testid="template-fill">
      {fields.map((field) => (
        <label key={field.elementId} className="flex flex-col gap-1">
          <span className="text-[11px] text-textColor/60">{field.slot.name}</span>

          {field.slot.kind === 'text' && (
            <input
              value={field.value}
              onChange={(e) =>
                store.getState().updateElement(field.elementId, fillSlot('text', e.target.value))
              }
              onBlur={() => store.getState().pushHistory('Fill slot')}
              className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden focus:border-designerAccent"
            />
          )}

          {field.slot.kind === 'color' && (
            <ColorSwatch
              value={field.value || '#000000'}
              onChange={(hex) => {
                store.getState().updateElement(field.elementId, fillSlot('color', hex));
                store.getState().pushHistory('Fill slot');
              }}
            />
          )}

          {field.slot.kind === 'image' && (
            <button
              type="button"
              onClick={() => chooseImage(field.elementId)}
              className="h-[30px] px-2 rounded-md border border-studioBorder text-[12px] text-textColor/80 hover:bg-boxHover text-start truncate"
            >
              {field.value
                ? field.value.split('/').pop()
                : t('designer_choose_image', 'Choose an image')}
            </button>
          )}
        </label>
      ))}
      {picker.element}
    </div>
  );
};
