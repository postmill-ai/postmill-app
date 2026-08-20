'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * Rename prompt for files and folders in the browse area, where there is no room
 * for the inline edit the list view and sidebar tree use.
 */
export const RenameDialog: FC<{
  initialName: string;
  label: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}> = ({ initialName, label, onSubmit, onClose }) => {
  const t = useT();
  const [name, setName] = useState(initialName);
  // Focus via ref rather than the autoFocus prop, matching AutoFocusInput in
  // folder-tree.tsx.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const trimmed = name.trim();
  const canSave = !!trimmed && trimmed !== initialName;

  const save = () => {
    if (!canSave) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <div className="flex flex-col gap-[14px] min-w-[280px]">
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] text-textColor">{label}</span>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
          className="h-[40px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-hidden focus:border-[#2B5CD3]"
        />
      </label>
      <div className="flex items-center justify-end gap-[8px]">
        <Button secondary onClick={onClose}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button disabled={!canSave} onClick={save}>
          {t('save', 'Save')}
        </Button>
      </div>
    </div>
  );
};
