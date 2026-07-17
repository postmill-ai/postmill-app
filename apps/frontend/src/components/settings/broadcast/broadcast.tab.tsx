'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const BroadcastTab: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('info');
  const [targetRoles, setTargetRoles] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [sendInApp, setSendInApp] = useState(true);
  const [sending, setSending] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !message.trim()) {
      toaster.show(t('fill_required_fields', 'Please fill in all required fields'), 'warning');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/admin/notifications/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          type,
          targetRoles: targetRoles
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean),
          channels: {
            email: sendEmail,
            push: false,
            inApp: sendInApp,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => 'Failed to send broadcast');
        toaster.show(text, 'warning');
        return;
      }
      toaster.show(t('broadcast_sent', 'Broadcast sent'), 'success');
      setTitle('');
      setMessage('');
      setTargetRoles('');
    } finally {
      setSending(false);
    }
  }, [fetch, toaster, t, title, message, type, targetRoles, sendEmail, sendInApp]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px]">
        <div className="flex flex-col gap-[12px]">
          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-textColor">
              {t('title', 'Title')} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
              placeholder={t('broadcast_title_placeholder', 'Announcement title')}
            />
          </div>
          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-textColor">
              {t('message', 'Message')} *
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none resize-none"
              placeholder={t('broadcast_message_placeholder', 'Announcement message')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div className="flex flex-col gap-[4px]">
              <label className="text-[13px] text-textColor">{t('type', 'Type')}</label>
              <select
                aria-label={t('type', 'Type')}
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
              >
                <option value="info">{t('info', 'Info')}</option>
                <option value="warning">{t('warning', 'Warning')}</option>
                <option value="announcement">{t('announcement', 'Announcement')}</option>
              </select>
            </div>
            <div className="flex flex-col gap-[4px]">
              <label className="text-[13px] text-textColor">
                {t('target_roles', 'Target roles (optional)')}
              </label>
              <input
                type="text"
                value={targetRoles}
                onChange={(e) => setTargetRoles(e.target.value)}
                className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
                placeholder={t('target_roles_placeholder', 'owner,admin')}
              />
            </div>
          </div>
          <div className="flex items-center gap-[16px]">
            <label className="flex items-center gap-[6px] cursor-pointer text-[13px]">
              <input
                type="checkbox"
                className="accent-btnPrimary w-[14px] h-[14px]"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              {t('send_email', 'Send email')}
            </label>
            <label className="flex items-center gap-[6px] cursor-pointer text-[13px]">
              <input
                type="checkbox"
                className="accent-btnPrimary w-[14px] h-[14px]"
                checked={sendInApp}
                onChange={(e) => setSendInApp(e.target.checked)}
              />
              {t('send_in_app', 'Send in-app')}
            </label>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={sending}
            className="w-fit px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] hover:bg-btnPrimary/90 disabled:opacity-50"
          >
            {sending ? t('sending', 'Sending...') : t('send_broadcast', 'Send Broadcast')}
          </button>
        </div>
      </div>
    </div>
  );
};
