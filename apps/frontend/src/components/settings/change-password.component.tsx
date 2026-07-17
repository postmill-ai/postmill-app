'use client';

import React, { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';

const ChangePasswordComponent: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    setError('');

    if (newPassword.length < 8) {
      setError(t('password_min_length', 'Password must be at least 8 characters'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('passwords_do_not_match', 'Passwords do not match'));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/user/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.message || t('error_occurred', 'An error occurred. Please try again.'));
        setLoading(false);
        return;
      }

      toaster.show(t('password_updated', 'Password updated successfully'), 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError(t('error_occurred', 'An error occurred. Please try again.'));
    }
    setLoading(false);
  }, [currentPassword, newPassword, confirmPassword, fetch, toaster, t]);

  return (
    <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] mt-[16px] flex flex-col gap-[24px]">
      <h4 className="text-[16px] font-[600]">{t('change_password', 'Change Password')}</h4>
      <div className="flex flex-col gap-[8px]">
        <label className="text-[14px] font-[500]">{t('current_password', 'Current Password')}</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="bg-newBgColor border border-newTableBorder rounded-[6px] px-[12px] py-[8px] text-[13px] text-textColor outline-none"
        />
      </div>
      <div className="flex flex-col gap-[8px]">
        <label className="text-[14px] font-[500]">{t('new_password', 'New Password')}</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="bg-newBgColor border border-newTableBorder rounded-[6px] px-[12px] py-[8px] text-[13px] text-textColor outline-none"
        />
      </div>
      <div className="flex flex-col gap-[8px]">
        <label className="text-[14px] font-[500]">{t('confirm_password', 'Confirm New Password')}</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="bg-newBgColor border border-newTableBorder rounded-[6px] px-[12px] py-[8px] text-[13px] text-textColor outline-none"
        />
      </div>
      {error && (
        <div className="text-[13px] text-red-500">{error}</div>
      )}
      <Button loading={loading} onClick={handleSubmit} className="w-fit">
        {t('update_password', 'Update Password')}
      </Button>
    </div>
  );
};

export default ChangePasswordComponent;
