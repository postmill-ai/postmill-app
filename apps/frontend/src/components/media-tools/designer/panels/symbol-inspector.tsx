'use client';

import React, { FC } from 'react';
import { ColorSwatch } from '../controls';
import { useBrandColors } from './use-brand-colors';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { symbolFillCommit } from '../symbol-edit';
import type { DesignerElement } from '../designer.store';
import type { SymbolDefinition } from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';

interface SymbolInspectorProps {
  element: DesignerElement;
  store: any;
}

/**
 * The instance-level controls for a symbol (the CTA lockup).
 *
 * An instance may only override per-child content through `symbolOverrides` —
 * structure stays definition-owned — so this panel exposes exactly that
 * channel: the colour of each text child, which is what "edit the CTA label
 * colour" means. Without a symbol branch in the Inspector the instance
 * selected fine but offered no colour UI at all.
 */
export const SymbolInspector: FC<SymbolInspectorProps> = ({ element, store }) => {
  const t = useT();
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const updateElement = store((s: any) => s.updateElement);
  const symbols = store((s: any) => s.doc.symbols) as SymbolDefinition[] | undefined;

  const definition = element.symbolId
    ? symbols?.find((d) => d.id === element.symbolId)
    : undefined;
  if (!definition) return null;

  const textChildren = definition.children.filter((c) => c.type === 'text');
  if (!textChildren.length) return null;

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_symbol_heading', 'Symbol')}
      </div>
      {textChildren.map((child) => (
        <ColorSwatch
          key={child.id}
          label={t('designer_symbol_label_color', '{{name}} text color', {
            name: child.id,
          })}
          value={element.symbolOverrides?.[child.id]?.fill || child.fill || '#000000'}
          onChange={(hex) =>
            updateElement(element.id, symbolFillCommit(element, child.id, hex))
          }
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      ))}
    </div>
  );
};
