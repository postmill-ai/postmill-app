'use client';

import React, { ReactNode, useCallback, useState, useRef, useEffect } from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { Wordmark } from '@gitroom/frontend/components/new-layout/wordmark';
import { UserAvatarMenu } from '@gitroom/frontend/components/new-layout/user-avatar-menu';
import { Plus_Jakarta_Sans } from 'next/font/google';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotProvider } from '@gitroom/frontend/components/layout/copilot.provider';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { BottomTabBar } from '@gitroom/frontend/components/new-layout/bottom-tab-bar';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';

// Lazy — only loaded when "New Campaign" is actually chosen (keeps the campaign-modal
// dependency graph out of the global layout bundle).
const CreateEditCampaignModal = dynamic(
  () =>
    import(
      '@gitroom/frontend/components/campaigns/index/create-edit-campaign.modal'
    ).then((m) => m.CreateEditCampaignModal),
  { ssr: false }
);

// Lazy — the CSV bulk-import surface is only pulled in when "Bulk Import" is chosen.
const BulkImport = dynamic(
  () =>
    import('@gitroom/frontend/components/composer/bulk/bulk.import').then(
      (m) => m.BulkImport
    ),
  { ssr: false }
);

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();
  const t = useT();

  const { billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const load = useCallback(
    async (path: string) => {
      return await (await fetch(path)).json();
    },
    [fetch]
  );
  const { data: user, mutate } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  const router = useRouter();
  const pathname = usePathname();
  // The header wordmark shows ONLY on the dashboard route (other pages show their
  // own <Title/> in the header instead).
  const isDashboard = pathname === '/dashboard';
  // Only gate once `user` has loaded. `!user?.setupCompleted` is truthy while the
  // SWR request is still in flight (user === undefined), which would redirect to
  // /setup on every reload before we even know the real value.
  //
  // Setup configures org-level providers (AI/channels/…) — an owner/admin concern. A member
  // CANNOT complete the required LLM step (the AI-config endpoints 403), so forcing them onto
  // /setup is a dead-end. Only redirect users who can actually finish it; everyone else
  // proceeds into the app, which runs in the existing no-AI state until an admin configures a
  // provider. Wait for permissions to resolve before deciding, so a member is never trapped.
  const permissions = usePermissions();
  const canCompleteSetup =
    permissions.isSuperAdmin || permissions.isOwner || permissions.isAdmin;
  const setupIncomplete = !!user && !user.setupCompleted;
  const mustSetup = setupIncomplete && permissions.isResolved && canCompleteSetup;

  useEffect(() => {
    if (mustSetup) {
      router.replace('/setup');
    }
  }, [mustSetup, router]);

  if (!user) return null;
  // Hold rendering while setup is incomplete and we don't yet know the role — avoids briefly
  // flashing the app to someone who is about to be redirected to /setup.
  if (setupIncomplete && !permissions.isResolved) return null;
  if (mustSetup) return null;

  return (
    <ContextWrapper user={user}>
      <CopilotProvider>
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-full text-newTextColor p-[12px] mobile:pb-[72px]',
                jakartaSans.className
              )}
            >
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex gap-[8px]">
                    <Support />
                    <div className="mobile:hidden flex flex-col bg-newBgColorInner w-[80px] rounded-[12px]">
                      <div
                        id="left-menu"
                        className={clsx(
                          'fixed h-full w-[64px] start-[17px] flex flex-1 top-0'
                        )}
                      >
                        <div className="flex flex-col h-full gap-[32px] flex-1 py-[12px]">
                          <Link href="/" aria-label={t('home', 'Home')}>
                            <Logo />
                          </Link>
                          <TopMenu />
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 bg-newBgLineColor rounded-[12px] overflow-hidden flex flex-col gap-[1px] blurMe">
                      <div className="flex bg-newBgColorInner h-[56px] lg:h-[80px] px-[20px] items-center">
                        <div className="text-[24px] font-[600] flex flex-1 items-center gap-[10px] min-w-0">
                          {/* Mobile: the left rail is hidden, so always show the
                              icon; add the wordmark only on the dashboard. */}
                          <Link
                            href="/"
                            aria-label={t('home', 'Home')}
                            className="mobile:flex hidden items-center gap-[8px] shrink-0"
                          >
                            <Logo size={34} className="" />
                            {isDashboard && (
                              <Wordmark height={26} className="text-textColor" />
                            )}
                          </Link>
                          {/* Desktop: the icon lives in the left rail; show the
                              wordmark only on the dashboard (other pages show the
                              <Title/> instead). */}
                          {isDashboard && (
                            <Link
                              href="/"
                              aria-label={t('home', 'Home')}
                              className="mobile:hidden flex shrink-0"
                            >
                              <Wordmark height={34} className="text-textColor" />
                            </Link>
                          )}
                          {/* The dashboard header already shows the wordmark; the
                              page Title (which resolves to "Home" for /dashboard)
                              would be redundant, so it's shown only off-dashboard. */}
                          {!isDashboard && <Title />}
                        </div>
                        <div className="flex gap-[20px] text-textItemBlur items-center">
                          {/* Secondary utilities collapse into the avatar menu on mobile. */}
                          <div className="contents mobile:hidden">
                            <div className="flex items-center justify-center w-[36px] h-[36px]">
                              <StreakComponent />
                            </div>
                            <div className="w-[1px] h-[20px] bg-blockSeparator" />
                            <OrganizationSelector />
                            <div className="hover:text-newTextColor flex items-center justify-center w-[36px] h-[36px]">
                              <ModeComponent />
                            </div>
                            <div className="flex items-center justify-center w-[36px] h-[36px] empty:hidden">
                              <ChromeExtensionComponent />
                            </div>
                            <div className="w-[1px] h-[20px] bg-blockSeparator" />
                            <div className="flex items-center justify-center w-[36px] h-[36px] empty:hidden">
                              <AttachToFeedbackIcon />
                            </div>
                          </div>
                          <CreateMenu />
                          <div className="flex items-center justify-center w-[36px] h-[36px]">
                            <NotificationComponent />
                          </div>
                          <div className="flex items-center justify-center w-[36px] h-[36px]">
                            <UserAvatarMenu />
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-1 gap-[1px]">{children}</div>
                    </div>
                  </div>
                  <BottomTabBar />
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotProvider>
    </ContextWrapper>
  );
};

// GitHub-style "create" control. The desktop header shows a bordered "+" button (with a caret)
// that opens a dropdown of these actions; on mobile — where the header "+" is hidden — the same
// rows live in the avatar menu. New Post / New Design are plain navigations; New Campaign opens
// the shared campaign modal; New Channel (admin-only) opens the add-channel flow.
const createMenuRow =
  'w-full flex items-center gap-[10px] px-[14px] py-[8px] text-[13px] text-textColor hover:bg-boxHover text-start';

const useCreateActions = () => {
  const t = useT();
  const modals = useModals();
  const { mutate } = useSWRConfig();
  const addChannel = useAddProvider(() => mutate('/integrations'), false);

  const openCampaign = useCallback(() => {
    modals.openModal({
      title: t('new_campaign', 'New Campaign'),
      withCloseButton: true,
      children: (
        <CreateEditCampaignModal
          editing={null}
          onDone={() => {
            modals.closeAll();
            mutate('/campaigns');
          }}
        />
      ),
    });
  }, [modals, mutate, t]);

  const openBulkImport = useCallback(() => {
    modals.openModal({
      title: t('bulk_import', 'Bulk Import'),
      withCloseButton: true,
      children: <BulkImport />,
    });
  }, [modals, t]);

  return { openCampaign, openChannel: addChannel, openBulkImport };
};

// The create actions as a list of menu rows, shared by the desktop "+" dropdown and the mobile
// avatar menu. `onSelect` closes the host menu; `showChannel` gates the admin-only channel row.
const CreateMenuItems: React.FC<{ onSelect?: () => void; showChannel: boolean }> = ({
  onSelect,
  showChannel,
}) => {
  const t = useT();
  const { openCampaign, openChannel, openBulkImport } = useCreateActions();
  return (
    <>
      <a
        href="/posts/post"
        role="menuitem"
        onClick={onSelect}
        className={createMenuRow}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        {t('new_post', 'New Post')}
      </a>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSelect?.();
          openBulkImport();
        }}
        className={createMenuRow}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M12 18v-6" />
          <path d="m9 15 3 3 3-3" />
        </svg>
        {t('bulk_import', 'Bulk Import')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSelect?.();
          openCampaign();
        }}
        className={createMenuRow}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m3 11 18-5v12L3 14v-3Z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
        {t('new_campaign', 'New Campaign')}
      </button>
      <a
        href="/media/designer"
        role="menuitem"
        onClick={onSelect}
        className={createMenuRow}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
        </svg>
        {t('new_design', 'New Design')}
      </a>
      {showChannel && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onSelect?.();
            openChannel();
          }}
          className={createMenuRow}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          {t('new_channel', 'New Channel')}
        </button>
      )}
    </>
  );
};

const CreateMenu = () => {
  const t = useT();
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup={true}
        aria-label={t('create_new', 'Create new')}
        title={t('create_new', 'Create new')}
        className="flex items-center gap-[4px] h-[32px] px-[8px] rounded-[8px] border border-newTableBorder hover:text-newTextColor hover:bg-boxHover"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-[40px] w-[210px] bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg z-[300] py-[4px]"
          role="menu"
        >
          <CreateMenuItems
            onSelect={() => setOpen(false)}
            showChannel={permissions.isAdmin}
          />
        </div>
      )}
    </div>
  );
};


