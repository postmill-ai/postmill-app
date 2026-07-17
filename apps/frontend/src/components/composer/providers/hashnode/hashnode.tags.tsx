'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { ReactTags } from 'react-tag-autocomplete';

export const HashnodeTags: FC<{
  name: string;
  label: string;
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, label } = props;
  const customFunc = useCustomProviderFunction();
  const [tags, setTags] = useState<any[]>([]);
  const { getValues, formState: form } = useSettings();
  const [tagValue, setTagValue] = useState<any[]>(
    () => getValues()[props.name] || []
  );
  const onDelete = useCallback(
    (tagIndex: number) => {
      const modify = tagValue.filter((_, i) => i !== tagIndex);
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [tagValue, name, onChange]
  );
  const onAddition = useCallback(
    (newTag: any) => {
      if (tagValue.length >= 4) {
        return;
      }
      const modify = [...tagValue, newTag];
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [tagValue, name, onChange]
  );
  useEffect(() => {
    customFunc.get('tags').then((data) => setTags(data));
  }, [customFunc]);
  const err =
    form && form.errors[props?.name!]
      ? (form?.errors?.[props?.name!]?.message as string)
      : undefined;
  if (!tags.length) {
    return null;
  }

  return (
    <div>
      <div className={`text-[14px] mb-[6px]`}>{label}</div>
      <ReactTags
        suggestions={tags || []}
        selected={tagValue || []}
        onAdd={onAddition}
        onDelete={onDelete}
      />
      <div className="text-dangerText text-[12px]">{err || <>&nbsp;</>}</div>
    </div>
  );
};
