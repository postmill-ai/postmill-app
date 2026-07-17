'use client';

import { FC, useState, useCallback, useEffect } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface PollOption {
  id: string;
  value: string;
}

interface PollData {
  options: string[];
  duration: number;
}

interface PollBuilderProps {
  value?: PollData;
  onChange: (poll: PollData | undefined) => void;
  maxOptions?: number;
  minOptions?: number;
  maxDuration?: number;
}

export const PollBuilder: FC<PollBuilderProps> = ({
  value,
  onChange,
  maxOptions = 4,
  minOptions = 2,
  maxDuration = 168,
}) => {
  const t = useT();
  const [isActive, setIsActive] = useState(!!value);
  const [options, setOptions] = useState<PollOption[]>(() => {
    const initial = value?.options || ['', ''];
    return initial.map((value) => ({
      id: crypto.randomUUID(),
      value,
    }));
  });
  const [duration, setDuration] = useState(value?.duration || 24);

  useEffect(() => {
    if (isActive) {
      const validOptions = options
        .map((o) => o.value)
        .filter((o) => o.trim().length > 0);
      if (validOptions.length >= minOptions) {
        onChange({ options: validOptions, duration });
      }
    } else {
      onChange(undefined);
    }
  }, [isActive, options, duration, minOptions, onChange]);

  const handleToggle = useCallback(() => {
    if (isActive) {
      setIsActive(false);
    } else {
      setIsActive(true);
    }
  }, [isActive]);

  const handleOptionChange = useCallback((id: string, text: string) => {
    setOptions((prev) =>
      prev.map((option) => (option.id === id ? { ...option, value: text } : option))
    );
  }, []);

  const addOption = useCallback(() => {
    if (options.length < maxOptions) {
      setOptions((prev) => [...prev, { id: crypto.randomUUID(), value: '' }]);
    }
  }, [options.length, maxOptions]);

  const removeOption = useCallback(
    (id: string) => {
      if (options.length > minOptions) {
        setOptions((prev) => prev.filter((option) => option.id !== id));
      }
    },
    [options.length, minOptions]
  );

  const durationOptions = [
    { value: 1, label: t('poll_duration_1_hour', '1 hour') },
    { value: 4, label: t('poll_duration_4_hours', '4 hours') },
    { value: 24, label: t('poll_duration_1_day', '1 day') },
    { value: 48, label: t('poll_duration_2_days', '2 days') },
    { value: 72, label: t('poll_duration_3_days', '3 days') },
    { value: 168, label: t('poll_duration_7_days', '7 days') },
  ].filter((d) => d.value <= maxDuration);

  return (
    <div className="mt-[12px] border border-newTableBorder rounded-[8px] p-[12px] bg-newBgColorInner">
      <label className="flex items-center gap-[8px] cursor-pointer">
        <input
          type="checkbox"
          checked={isActive}
          onChange={handleToggle}
          className="w-[16px] h-[16px] rounded-[4px] accent-btnPrimary [&:checked]:bg-btnPrimary"
        />
        <span className="text-[13px] font-medium">
          {t('add_poll', 'Add Poll')}
        </span>
      </label>

      {isActive && (
        <div className="mt-[12px] flex flex-col gap-[8px]">
          {options.map((option, i) => (
            <div key={option.id} className="flex items-center gap-[6px]">
              <input
                className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-[13px] text-textColor flex-1"
                value={option.value}
                onChange={(e) => handleOptionChange(option.id, e.target.value)}
                placeholder={t('poll_option_placeholder', 'Option {{number}}...', { number: i + 1 })}
                maxLength={100}
                aria-label={t('poll_option_aria', 'Poll option {{index}}', { index: i + 1 })}
              />
              {options.length > minOptions && (
                <button
                  onClick={() => removeOption(option.id)}
                  className="text-red-500 text-[18px] leading-none hover:opacity-80"
                  aria-label={t('remove_option', 'Remove option')}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {options.length < maxOptions && (
            <button
              onClick={addOption}
              className="text-textColor text-[13px] self-start hover:opacity-80"
            >
              {t('add_option', '+ Add Option')}
            </button>
          )}

          <div className="flex items-center gap-[8px] mt-[4px]">
            <span className="text-[12px] text-newTableText">
              {t('poll_duration', 'Duration:')}
            </span>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[6px] text-[13px] text-textColor"
              aria-label={t('poll_duration', 'Duration:')}
            >
              {durationOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
