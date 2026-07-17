'use client';

import React, { FC } from 'react';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';

export const ProfileComponent: FC<{
  form?: any;
  isLoading?: boolean;
}> = ({ form, isLoading }) => {
  const t = useT();

  if (!form) return null;

  return (
    <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] mt-[16px] mb-[16px] flex flex-col gap-[24px]">
      <h4 className="text-[16px] font-[600]">{t('profile', 'Profile')}</h4>
      <Input
        label={t('full_name', 'Full Name')}
        aria-label={t('full_name', 'Full Name')}
        {...form.register('fullname')}
      />
      <Input
        label={t('last_name', 'Last Name')}
        aria-label={t('last_name', 'Last Name')}
        {...form.register('lastName')}
      />
      <div className="flex flex-col gap-[8px]">
        <label className="text-[14px] font-[500]">{t('bio', 'Bio')}</label>
        <textarea
          {...form.register('bio')}
          aria-label={t('bio', 'Bio')}
          rows={3}
          className="bg-newBgColor border border-newTableBorder rounded-[6px] px-[12px] py-[8px] text-[13px] text-textColor outline-none resize-none"
        />
      </div>
      <div className="flex flex-col gap-[8px]">
        <label className="text-[14px] font-[500]">{t('profile_picture', 'Profile Picture')}</label>
        <p className="text-[12px] text-textColor/60">
          {t('profile_picture_note', 'Upload or remove your profile picture using the avatar section in settings.')}
        </p>
      </div>
      {!isLoading && (
        <Button type="submit" className="w-fit">
          {t('save', 'Save')}
        </Button>
      )}
    </div>
  );
};
