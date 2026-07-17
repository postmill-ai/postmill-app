'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ExtraFieldProps } from './extra-field.types';
import { InstanceNameField } from './instance-name.field';
import { CustomDomainField } from './custom-domain.field';
import { RegionChecklistField } from './region-checklist.field';
import { OAuthBlockField } from './oauth-block.field';

/**
 * Generic text/password/select extra field writing into `extra[spec.key]`.
 * `spec` is descriptor DATA (static literals in a `.ts`/module-scope array) —
 * labels/placeholders/options are translated here at the render site with a
 * key derived from the stable `spec.key`, English default verbatim.
 */
const GenericExtraField: React.FC<ExtraFieldProps> = ({ spec, state, setExtra }) => {
  const t = useT();
  const value = state.extra[spec.key] || '';
  return (
    <div className="flex flex-col gap-[4px]">
      <label className="text-[13px] text-newTableText">
        {spec.label && t('provider_field_' + spec.key, spec.label)}
        {spec.required && <span className="text-red-500 ml-[2px]">*</span>}
      </label>
      {spec.type === 'select' && spec.options ? (
        <select
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
          value={value}
          onChange={(e) => setExtra(spec.key, e.target.value)}
        >
          <option value="">
            {spec.placeholder
              ? t('provider_field_placeholder_' + spec.key, spec.placeholder)
              : t('select_option', 'Select...')}
          </option>
          {spec.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t('provider_field_option_' + spec.key + '_' + opt.value, opt.label)}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
          type={spec.type === 'password' ? 'password' : 'text'}
          placeholder={
            spec.placeholder
              ? t('provider_field_placeholder_' + spec.key, spec.placeholder)
              : ''
          }
          value={value}
          onChange={(e) => setExtra(spec.key, e.target.value)}
        />
      )}
      {spec.help && <div className="text-[11px] text-newTableText">{spec.help}</div>}
    </div>
  );
};

/** Render an extra field by its `spec.type`. */
export const ExtraField: React.FC<ExtraFieldProps> = (props) => {
  switch (props.spec.type) {
    case 'instance-name':
      return <InstanceNameField {...props} />;
    case 'custom-domain':
      return <CustomDomainField {...props} />;
    case 'region-checklist':
      return <RegionChecklistField {...props} />;
    case 'oauth-block':
      return <OAuthBlockField {...props} />;
    default:
      return <GenericExtraField {...props} />;
  }
};
