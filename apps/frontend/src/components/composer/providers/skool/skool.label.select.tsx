'use client';

import { FC, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const SkoolLabelSelectInner: FC<{
  name: string;
  groupId: string;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, groupId } = props;
  const t = useT();
  const customFunc = useCustomProviderFunction();
  const [labels, setLabels] = useState([]);
  const { getValues } = useSettings();
  const [currentLabel, setCurrentLabel] = useState<string | undefined>(
    () => getValues()[name]
  );
  const onChangeInner = (event: {
    target: {
      value: string;
      name: string;
    };
  }) => {
    setCurrentLabel(event.target.value);
    onChange(event);
  };
  useEffect(() => {
    customFunc.get('label', { id: groupId }).then((data) => setLabels(data));
  }, [groupId, customFunc]);
  if (!labels.length) {
    return null;
  }
  return (
    <Select
      name={name}
      label={t('select_label', 'Select Label')}
      onChange={onChangeInner}
      value={currentLabel}
    >
      <option value="">{t('select_1', '--Select--')}</option>
      {labels.map((label: any) => (
        <option key={label.id} value={label.id}>
          {label.name}
        </option>
      ))}
    </Select>
  );
};

export const SkoolLabelSelect: FC<{
  name: string;
  groupId: string | undefined;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = (props) => {
  // Remount the inner selector whenever the parent group changes so labels and
  // the current value reset without effect-derived setState.
  if (!props.groupId) {
    return null;
  }
  return <SkoolLabelSelectInner key={props.groupId} {...props} groupId={props.groupId} />;
};
