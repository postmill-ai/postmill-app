'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useSidebarCollapse } from '@gitroom/frontend/components/layout/use-sidebar-collapse';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { SubmenuStrip } from '@gitroom/frontend/components/new-layout/submenu-strip';
import {
  SETTINGS_NAV,
  SETTINGS_SECTION_ORDER,
  type SettingsNavItem,
} from '@gitroom/frontend/components/settings/settings-nav.config';

// Settings shell: the collapsible left rail + the page header, shared across every
// /settings/* route. Replaces the old single-page SettingsPopup tab switcher — each rail
// item is now a real <Link> and the active item follows usePathname (mirrors media/layout.tsx).
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const user = useUser();
  const permissions = usePermissions();
  const { isGeneral, billingEnabled } = useVariables();
  const url = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle } = useSidebarCollapse('settings:sidebar-collapsed');

  const showLogout = !url.get('onboarding') || user?.tier?.current === 'STARTER';

  // R5: members whose role lacks settings:read get a no-access state.
  const settingsDenied =
    permissions.isResolved && !permissions.hasPermission('settings', 'read');

  const items = useMemo(() => {
    const ctx = { user, permissions, isGeneral, billingEnabled, showLogout };
    const visible = SETTINGS_NAV.filter((i) => (i.gate ? i.gate(ctx) : true));
    // Keep the category order, sort alphabetically within each category (matches old nav).
    return [...visible].sort((a, b) => {
      const sectionDiff =
        SETTINGS_SECTION_ORDER.indexOf(a.section || '') -
        SETTINGS_SECTION_ORDER.indexOf(b.section || '');
      if (sectionDiff !== 0) return sectionDiff;
      return t(a.labelKey, a.labelDefault).localeCompare(t(b.labelKey, b.labelDefault));
    });
  }, [user, permissions, isGeneral, billingEnabled, showLogout, t]);

  const isActive = (item: SettingsNavItem) => pathname.startsWith(item.href);
  const activeItem = items.find(isActive);

  if (settingsDenied) {
    return (
      <div className="bg-newBgColorInner flex-1 flex flex-col items-center justify-center p-[40px] gap-[12px]">
        <div className="text-[20px] font-[600]">
          {t('settings_no_access_title', 'No access to settings')}
        </div>
        <div className="text-[14px] text-newTableText text-center max-w-[420px]">
          {t(
            'settings_no_access_description',
            'Your role does not include access to organization settings. Ask an organization admin if you need it.'
          )}
        </div>
        <a href="/dashboard" className="text-[14px] text-btnPrimary hover:underline">
          {t('back_to_dashboard', 'Back to dashboard')}
        </a>
      </div>
    );
  }

  const stripItems = items.map((item) => ({
    label: t(item.labelKey, item.labelDefault),
    icon: item.icon,
    section: item.section,
    active: isActive(item),
    onClick: () => router.push(item.href),
  }));

  return (
    <>
      {/* Desktop side rail (collapsible). Hidden on mobile — replaced by the strip. */}
      <div
        className={clsx(
          'mobile:hidden bg-newBgColorInner flex flex-col transition-all p-[20px] h-[calc(100vh-104px)] mobile:h-auto min-h-0',
          collapsed ? 'w-[76px]' : 'w-[260px]'
        )}
      >
        <div
          className={clsx(
            'flex items-center mb-[12px] h-[24px]',
            collapsed ? 'justify-center' : 'justify-end'
          )}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? t('expand_menu', 'Expand menu') : t('collapse_menu', 'Collapse menu')}
            title={collapsed ? t('expand_menu', 'Expand menu') : t('collapse_menu', 'Collapse menu')}
            className="w-[24px] h-[24px] flex items-center justify-center rounded-[6px] text-newTableText hover:text-textColor hover:bg-boxHover transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={clsx('transition-transform', collapsed && 'rotate-180')}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
        <div className="flex flex-1 min-h-0 flex-col gap-[4px] overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-transparent">
          {(() => {
            const elements: React.ReactNode[] = [];
            let currentSection = '';
            items.forEach((item) => {
              if (item.section && item.section !== currentSection) {
                currentSection = item.section;
                const sectionKey =
                  item.section === 'Workspace'
                    ? 'settings_section_workspace'
                    : item.section === 'Automation'
                      ? 'settings_section_automation'
                      : 'settings_section_developer';
                const sectionDefault = item.section;
                elements.push(
                  <div
                    key={`section-${item.section}`}
                    className={clsx(
                      'text-[10px] font-semibold text-newTableText uppercase tracking-wider px-[4px] mt-[12px] mb-[4px]',
                      collapsed && 'hidden'
                    )}
                  >
                    {t(sectionKey, sectionDefault)}
                  </div>
                );
              }
              const active = isActive(item);
              const label = t(item.labelKey, item.labelDefault);
              elements.push(
                <Link
                  href={item.href}
                  key={item.key}
                  title={label}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'group/rail relative w-full text-start flex items-center gap-[10px] rounded-e-[6px] text-[13px] text-textColor transition-colors',
                    collapsed ? 'justify-center px-[8px] py-[10px]' : 'ps-[10px] pe-[12px] py-[8px]',
                    active ? 'bg-boxHover' : 'hover:bg-boxHover'
                  )}
                >
                  <span
                    className={clsx(
                      'absolute start-0 top-1/2 -translate-y-1/2 h-[18px] w-[3px] rounded-e-[2px] bg-btnPrimary transition-opacity',
                      active ? 'opacity-100' : 'opacity-0 group-hover/rail:opacity-100',
                      collapsed && 'hidden'
                    )}
                  />
                  <span className="w-[18px] h-[18px] flex items-center justify-center shrink-0">
                    {item.icon}
                  </span>
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );
            });
            return elements;
          })()}
        </div>
        <div>
          {showLogout && (
            <div className={clsx('mt-4 flex', collapsed && 'justify-center')}>
              <LogoutComponent isIcon={collapsed} />
            </div>
          )}
        </div>
      </div>

      <div className="bg-newBgColorInner flex-1 flex-col flex min-w-0 mobile:p-0 p-[20px] gap-[12px] h-[calc(100vh-104px)] mobile:h-auto min-h-0 overflow-y-auto mobile:overflow-visible">
        <SubmenuStrip ariaLabel={t('settings_sections_aria', 'Settings sections')} items={stripItems} />
        <div className="flex flex-col gap-[12px] mobile:p-[16px]">
          <div className="w-full mx-auto gap-[24px] flex flex-col relative rounded-[4px]">
            {activeItem && (
              <div className="flex flex-col gap-[4px]">
                <h2 className="text-[20px] font-semibold text-textColor">
                  {t(activeItem.labelKey, activeItem.labelDefault)}
                </h2>
                <p className="text-[13px] text-newTableText">
                  {t(activeItem.descKey, activeItem.descDefault)}
                </p>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
