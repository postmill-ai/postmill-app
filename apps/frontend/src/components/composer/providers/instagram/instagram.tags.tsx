'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { ReactTags } from 'react-tag-autocomplete';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const InstagramCollaboratorsTags: FC<{
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
  const { getValues } = useSettings();
  const { integration } = useIntegration();
  const [tagValue, setTagValue] = useState<any[]>(
    () => getValues()[props.name] || []
  );
  const [suggestions, setSuggestions] = useState<string>('');
  const t = useT();

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
      if (tagValue.length >= 3) {
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

  const suggestionsArray = useMemo(() => {
    return [
      ...tagValue,
      {
        label: suggestions,
        value: suggestions,
      },
    ].filter((f) => f.label);
  }, [suggestions, tagValue]);
  return (
    <div>
      <div>
        <div className={clsx(`text-[14px] mb-[6px]`)}>{label}</div>
        <ReactTags
          placeholderText={t('add_a_tag', 'Add a tag')}
          suggestions={suggestionsArray}
          selected={tagValue}
          onAdd={onAddition}
          onInput={setSuggestions}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
};
