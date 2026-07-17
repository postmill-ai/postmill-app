'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ExtraFieldProps } from './extra-field.types';

/**
 * Custom-domain text input (shortlinks). Only renders when the provider supports
 * a custom domain (`meta.capabilities.customDomain`). Writes `extra[spec.key]`.
 */
export const CustomDomainField: React.FC<ExtraFieldProps> = ({
  spec,
  state,
  setExtra,
  meta,
}) => {
  const t = useT();
  if (meta?.capabilities && meta.capabilities.customDomain === false) return null;
  return (
    <div className="flex flex-col gap-[4px]">
      <label className="text-[13px] text-newTableText">
        {spec.label || t('custom_domain', 'Custom Domain')}
      </label>
      <input
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
        type="text"
        placeholder={meta?.defaultDomain || spec.placeholder || 'custom.domain.com'}
        value={state.extra[spec.key] || ''}
        onChange={(e) => setExtra(spec.key, e.target.value)}
      />
    </div>
  );
};
