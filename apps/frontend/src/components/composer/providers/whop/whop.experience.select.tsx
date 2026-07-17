'use client';

import { FC, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const WhopExperienceSelectInner: FC<{
  name: string;
  companyId: string;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, companyId } = props;
  const t = useT();
  const customFunc = useCustomProviderFunction();
  const [experiences, setExperiences] = useState([]);
  const { getValues } = useSettings();
  const [currentExperience, setCurrentExperience] = useState<
    string | undefined
  >(() => getValues()[name]);
  const onChangeInner = (event: {
    target: {
      value: string;
      name: string;
    };
  }) => {
    setCurrentExperience(event.target.value);
    onChange(event);
  };
  useEffect(() => {
    customFunc
      .get('experiences', { id: companyId })
      .then((data) => setExperiences(data));
  }, [companyId, customFunc]);
  if (!experiences.length) {
    return null;
  }
  return (
    <Select
      name={name}
      label={t('select_forum', 'Select Forum')}
      onChange={onChangeInner}
      value={currentExperience}
    >
      <option value="">{t('select_1', '--Select--')}</option>
      {experiences.map((experience: any) => (
        <option key={experience.id} value={experience.id}>
          {experience.name}
        </option>
      ))}
    </Select>
  );
};

export const WhopExperienceSelect: FC<{
  name: string;
  companyId: string | undefined;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = (props) => {
  // Remount the inner selector whenever the parent company changes so the
  // experience list and current value reset without effect-derived setState.
  if (!props.companyId) {
    return null;
  }
  return (
    <WhopExperienceSelectInner
      key={props.companyId}
      {...props}
      companyId={props.companyId}
    />
  );
};
