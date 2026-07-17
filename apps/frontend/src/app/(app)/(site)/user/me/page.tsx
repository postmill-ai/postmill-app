'use client';

import React, { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import clsx from 'clsx';
import { ProfileComponent } from '@gitroom/frontend/components/settings/profile.component';
import MetricComponent from '@gitroom/frontend/components/settings/metric.component';
import ChangePasswordComponent from '@gitroom/frontend/components/settings/change-password.component';
import { NotificationPreferencesPanel } from '@gitroom/frontend/components/settings/notifications/notification-preferences.panel';

const tabs = [
  { key: 'profile', label: 'Profile' },
  { key: 'security', label: 'Security' },
  { key: 'notifications', label: 'Notifications' },
] as const;
// Keys profile/notifications already exist in translation.json; security is added
// in the same i18n backfill so all three tabs translate consistently.

export default function ProfilePage() {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const [tab, setTab] = useState('profile');

  const resolver = useMemo(() => classValidatorResolver(UserDetailDto), []);
  const form = useForm<UserDetailDto>({ resolver });

  const loadProfile = useCallback(async () => {
    const personal = await (await fetch('/user/personal')).json();
    form.setValue('fullname', personal.name || '');
    form.setValue('lastName', personal.lastName || '');
    form.setValue('bio', personal.bio || '');
    form.setValue('picture', personal.picture);
  }, [form, fetch]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const submit = useCallback(async (val: UserDetailDto) => {
    await fetch('/user/personal', {
      method: 'POST',
      body: JSON.stringify(val),
    });
    toast.show(t('profile_updated', 'Profile updated'), 'success');
  }, [fetch, toast, t]);

  return (
    <div className="flex flex-col max-w-[800px] mx-auto w-full p-[24px]">
      <h1 className="text-[24px] font-[700] mb-[24px]">{t('settings', 'Settings')}</h1>
      <div className="flex gap-[8px] border-b border-newTableBorder mb-[24px]">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={clsx(
              'pb-[12px] px-[4px] text-[14px] font-[500] border-b-2 transition-colors',
              tab === key
                ? 'border-btnPrimary text-textColor'
                : 'border-transparent text-textColor/50 hover:text-textColor/80'
            )}
          >
            {t(key, label)}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)}>
            <ProfileComponent form={form} isLoading={false} />
            <MetricComponent />
          </form>
        </FormProvider>
      )}

      {tab === 'security' && (
        <>
          <ChangePasswordComponent />
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] mt-[16px] flex flex-col gap-[24px]">
            <h4 className="text-[16px] font-[600]">{t('active_sessions', 'Active sessions')}</h4>
            <SessionsList />
            <button
              type="button"
              onClick={async () => {
                const confirmed = await deleteDialog(
                  t('logout_all_devices_confirm', 'Are you sure you want to log out all devices? You will be redirected to the login page.'),
                  t('logout_all', 'Log out all devices'),
                  t('confirm_logout', 'Confirm Logout')
                );
                if (confirmed) {
                  await fetch('/user/sessions/revoke-all', { method: 'POST' });
                  await fetch('/auth/logout', { method: 'POST' });
                  window.location.href = '/login';
                }
              }}
              className="bg-red/10 border border-red/30 text-red rounded-[6px] px-[16px] py-[10px] text-[13px] font-[500] w-fit cursor-pointer hover:bg-red/20 transition-colors"
            >
              {t('logout_all_devices', 'Log out all other sessions')}
            </button>
          </div>
        </>
      )}

      {tab === 'notifications' && <NotificationPreferencesPanel />}
    </div>
  );
}

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
}

function parseUA(ua: string, t: ReturnType<typeof useT>) {
  let browserKey = 'browser_unknown';
  let browserDefault = 'Unknown Browser';
  let osKey = 'os_unknown';
  let osDefault = 'Unknown OS';
  let isMobile = false;

  if (/Edge?|Edg?\//.test(ua)) {
    browserKey = 'browser_edge';
    browserDefault = 'Edge';
  } else if (/Chrome/.test(ua) && !/Edg/.test(ua)) {
    browserKey = 'browser_chrome';
    browserDefault = 'Chrome';
  } else if (/Firefox/.test(ua)) {
    browserKey = 'browser_firefox';
    browserDefault = 'Firefox';
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    browserKey = 'browser_safari';
    browserDefault = 'Safari';
  }

  if (/Windows/.test(ua)) {
    osKey = 'os_windows';
    osDefault = 'Windows';
  } else if (/Mac/.test(ua) && !/iPhone|iPad/.test(ua)) {
    osKey = 'os_macos';
    osDefault = 'macOS';
  } else if (/Android/.test(ua)) {
    osKey = 'os_android';
    osDefault = 'Android';
  } else if (/iPhone|iPad/.test(ua)) {
    osKey = 'os_ios';
    osDefault = 'iOS';
  } else if (/Linux/.test(ua)) {
    osKey = 'os_linux';
    osDefault = 'Linux';
  }

  if (/Mobi|Android|iPhone|iPad|iPod/.test(ua)) isMobile = true;

  return {
    browser: t(browserKey, browserDefault),
    os: t(osKey, osDefault),
    isMobile,
  };
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(i18next.resolvedLanguage || 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const useSessions = () => {
  const fetch = useFetch();

  const load = useCallback(async (): Promise<Session[]> => {
    return (await fetch('/user/sessions')).json();
  }, [fetch]);

  return useSWR<Session[]>('user-sessions', load);
};

const SessionsList: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { data, mutate } = useSessions();
  const sessions = data || [];
  const currentUA = useMemo(() => parseUA(navigator.userAgent, t), [t]);

  const revokeSession = useCallback(async (id: string) => {
    await fetch(`/user/sessions/${id}/revoke`, { method: 'POST' });
    mutate();
  }, [fetch, mutate]);

  const isCurrentSession = (ua: string | null) => {
    if (!ua) return false;
    const parsed = parseUA(ua, t);
    return parsed.browser === currentUA.browser && parsed.os === currentUA.os;
  };

  return (
    <div className="flex flex-col gap-[12px]">
      {sessions.map((session) => {
        const parsed = session.userAgent
          ? parseUA(session.userAgent, t)
          : {
              browser: t('unknown', 'Unknown'),
              os: t('unknown', 'Unknown'),
              isMobile: false,
            };
        const current = isCurrentSession(session.userAgent);

        return (
          <div key={session.id} className="flex items-center gap-[12px] bg-newBgColor border border-newTableBorder rounded-[6px] px-[16px] py-[12px]">
            <div className="w-[32px] h-[32px] rounded-full bg-btnPrimary/20 flex items-center justify-center text-[14px]">
              {parsed.isMobile ? '📱' : '💻'}
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-[500] text-textColor">
                {current
                  ? t('current_device', 'Current device')
                  : t('browser_on_os', '{{browser}} on {{os}}', {
                      browser: parsed.browser,
                      os: parsed.os,
                    })}
                {session.ip && !current && (
                  <span className="text-textColor/40 font-[400] ml-[8px] text-[12px]">
                    {session.ip}
                  </span>
                )}
              </p>
              <p className="text-[12px] text-textColor/40 mt-[2px]">
                {t('last_used', 'Last used')}: {formatDate(session.lastUsedAt)}
              </p>
            </div>
            {current && (
              <span className="text-[11px] text-green font-[500] bg-green/10 px-[8px] py-[2px] rounded-full">
                {t('active', 'Active')}
              </span>
            )}
            {!current && (
              <button
                type="button"
                onClick={() => revokeSession(session.id)}
                className="text-[11px] text-red font-[500] bg-red/10 px-[8px] py-[2px] rounded-full hover:bg-red/20 transition-colors"
              >
                {t('revoke', 'Revoke')}
              </button>
            )}
          </div>
        );
      })}
      {sessions.length === 0 && (
        <p className="text-[13px] text-textColor/40">{t('no_sessions', 'No active sessions')}</p>
      )}
    </div>
  );
};
