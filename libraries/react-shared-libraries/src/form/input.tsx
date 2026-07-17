'use client';

import {
  DetailedHTMLProps,
  FC,
  InputHTMLAttributes,
  ReactNode,
  useEffect,
  useMemo,
} from 'react';
import { clsx } from 'clsx';
import { useFormContext, useWatch } from 'react-hook-form';
import { TranslatedLabel } from '../translation/translated-label';

const WatchTrigger: FC<{
  name: string;
  customUpdate?: () => void;
}> = ({ name, customUpdate }) => {
  const form = useFormContext();
  const watchedValue = useWatch({
    name,
    control: form?.control,
    disabled: !form,
  });
  useEffect(() => {
    if (customUpdate) {
      customUpdate();
    }
  }, [watchedValue, customUpdate]);
  return null;
};

export const Input: FC<
  DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & {
    removeError?: boolean;
    error?: any;
    disableForm?: boolean;
    customUpdate?: () => void;
    label: string;
    name: string;
    icon?: ReactNode;
    translationKey?: string;
    translationParams?: Record<string, string | number>;
  }
> = (props) => {
  const {
    label,
    icon,
    removeError,
    customUpdate,
    className,
    disableForm,
    error,
    translationKey,
    translationParams,
    ...rest
  } = props;
  const form = useFormContext();
  const fieldError = form?.formState?.errors?.[props.name]?.message as
    | string
    | undefined;
  const err = useMemo(() => {
    if (error) return error;
    return fieldError;
  }, [fieldError, error]);
  return (
    <div className="flex flex-col gap-[6px]">
      {form && customUpdate && (
        <WatchTrigger name={props.name} customUpdate={customUpdate} />
      )}
      {!!label && (
        <div className={`text-[14px]`}>
          <TranslatedLabel
            label={label}
            translationKey={translationKey}
            translationParams={translationParams}
          />
        </div>
      )}
      <div
        className={clsx(
          'bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor placeholder-textColor flex items-center justify-center focus-within:border-btnPrimary focus-within:ring-2 ring-btnPrimary/20',
          err && 'border-red-400',
          className
        )}
      >
        {icon && <div className="ps-[16px]">{icon}</div>}
        <input
          className={clsx(
            'h-full bg-transparent outline-none flex-1 text-[14px] text-textColor',
            icon ? 'pl-[8px] pe-[16px]' : 'px-[16px]'
          )}
          {...(disableForm ? {} : form.register(props.name))}
          {...rest}
        />
      </div>
      {!removeError && (
        <div className="text-red-400 text-[12px]">{err || <>&nbsp;</>}</div>
      )}
    </div>
  );
};
