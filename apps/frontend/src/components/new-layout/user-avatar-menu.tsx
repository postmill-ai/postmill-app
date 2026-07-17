'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { LanguageMenuRow } from '@gitroom/frontend/components/layout/language.component';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';

const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  { ssr: false }
);

export const UserAvatarMenu = () => {
  const user = useUser();
  const t = useT();
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // R5: hide the Settings entry for members whose role lacks settings:read.
  // Shown optimistically while permissions load; backend 403s backstop.
  const showSettings =
    !permissions.isResolved || permissions.hasPermission('settings', 'read');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup={true}
        aria-label={t('account_menu', 'Account menu')}
        className="flex items-center gap-[8px] hover:text-newTextColor"
      >
        {user.profile?.avatarUrl || user.profile?.picture?.path ? (
          <SafeImage
            src={user.profile?.avatarUrl || user.profile?.picture?.path || ''}
            alt=""
            className="w-[28px] h-[28px] rounded-full object-cover border border-newTableBorder"
          />
        ) : (
          <div className="w-[28px] h-[28px] rounded-full bg-btnPrimary flex items-center justify-center text-white text-[12px] font-[600]">
            {(user.profile?.name || user.email || '?')[0].toUpperCase()}
          </div>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-[36px] w-[200px] mobile:w-[260px] bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg z-[300] py-[4px]" role="menu">
          <div className="px-[14px] py-[8px] border-b border-newTableBorder">
            <div className="text-[13px] font-[600] text-textColor truncate">
              {user.profile?.name || user.email}
            </div>
            {user.email && (
              <div className="text-[11px] text-textColor/60 truncate">
                {user.email}
              </div>
            )}
          </div>
          {/* Secondary utilities live here on mobile (hidden on desktop, where
              they sit in the top bar). */}
          <div className="mobile:block hidden px-[14px] py-[10px] border-b border-newTableBorder text-textItemBlur">
            <div className="flex items-center gap-[18px] flex-wrap">
              <StreakComponent />
              <div className="hover:text-newTextColor flex items-center justify-center">
                <ModeComponent />
              </div>
              <div className="flex items-center justify-center empty:hidden">
                <AttachToFeedbackIcon />
              </div>
              <div className="flex items-center justify-center empty:hidden">
                <ChromeExtensionComponent />
              </div>
            </div>
            <div className="mt-[10px] empty:hidden">
              <OrganizationSelector asOpenSelect={true} />
            </div>
          </div>
          <a
            href="/user/me"
            role="menuitem"
            className="block px-[14px] py-[8px] text-[13px] text-textColor hover:bg-boxHover"
          >
            {t('profile', 'Profile')}
          </a>
          {showSettings && (
            <a
              href="/settings"
              role="menuitem"
              className="block px-[14px] py-[8px] text-[13px] text-textColor hover:bg-boxHover"
            >
              {t('settings', 'Settings')}
            </a>
          )}
          <LanguageMenuRow onOpen={() => setOpen(false)} />
          <a
            href="https://docs.postmill.ai"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="block px-[14px] py-[8px] text-[13px] text-textColor hover:bg-boxHover"
          >
            {t('documentation', 'Documentation')}
          </a>
          <a
            href="/logout"
            role="menuitem"
            className="block px-[14px] py-[8px] text-[13px] text-red-500 hover:bg-boxHover"
          >
            {t('logout', 'Logout')}
          </a>
        </div>
      )}
    </div>
  );
};
