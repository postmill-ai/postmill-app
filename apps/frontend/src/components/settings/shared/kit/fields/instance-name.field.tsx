'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ExtraFieldProps } from './extra-field.types';

/** "Configuration Name" text input (shortlinks/channels). Writes `state.name`. */
export const InstanceNameField: React.FC<ExtraFieldProps> = ({
  spec,
  state,
  setName,
}) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[4px]">
      <label className="text-[13px] text-newTableText">
        {spec.label
          ? t('provider_field_' + spec.key, spec.label)
          : t('config_name', 'Configuration Name')}
      </label>
      <input
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
        type="text"
        placeholder={
          spec.placeholder
            ? t('provider_field_placeholder_' + spec.key, spec.placeholder)
            : t('config_name_placeholder', 'e.g. My Bitly Account')
        }
        value={state.name}
        onChange={(e) => setName(e.target.value)}
      />
    </div>
  );
};
