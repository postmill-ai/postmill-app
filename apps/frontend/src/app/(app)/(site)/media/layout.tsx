'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { useSidebarCollapse } from '@postmill-ai/frontend/components/layout/use-sidebar-collapse';
import { SubmenuStrip } from '@postmill-ai/frontend/components/new-layout/submenu-strip';
import { StudioErrorBoundary } from '@postmill-ai/frontend/components/media-tools/studio-error-boundary';
import {
  MEDIA_SECTION_LABELS,
  SORTED_MEDIA_TABS,
  providerIdentifier,
} from '@postmill-ai/frontend/components/media-tools/media-tools.nav';
import { useEnabledMediaProviders } from '@postmill-ai/frontend/components/media-tools/use-enabled-media-providers';
import { MEDIA_QUEUE_HREF } from '@postmill-ai/frontend/components/dashboard/destinations';

// The render queue is pinned above the studio sections rather than added to
// MEDIA_TABS: it reports on the studios, it isn't one of them, and the tab
// counts (46 = 2 platform + 38 provider + 6 stock) are a documented invariant.
const QueueIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2.5 21 7l-9 4.5L3 7l9-4.5Z" />
    <path d="m3 12 9 4.5L21 12" />
    <path d="m3 17 9 4.5L21 17" />
  </svg>
);

export default function MediaLayout({ children }: { children: React.ReactNode }) {
  // Named `translate` (not `t`) because `t` is already used as the tab loop variable below.
  const translate = useT();
  const pathname = usePathname();
  const permissions = usePermissions();
  const { collapsed, toggle } = useSidebarCollapse('media:sidebar-collapsed');
  const { data: enabledProviders } = useEnabledMediaProviders();
  const tabLabel = (tab: (typeof SORTED_MEDIA_TABS)[number]) =>
    tab.labelKey ? translate(tab.labelKey, tab.label) : tab.label;

  // Only show studios the org can actually use: Platform tools and stock
  // browsers (Content Pack) are always available, while provider studios appear
  // only once their provider is configured + enabled. Both the desktop rail and
  // the mobile strip filter to this set (configure providers in Settings).
  const isTabEnabled = (t: (typeof SORTED_MEDIA_TABS)[number]) =>
    t.section !== 'Providers' || (enabledProviders?.has(providerIdentifier(t.href)) ?? false);
  const railTabs = SORTED_MEDIA_TABS.filter(isTabEnabled);
  const queueActive = pathname.startsWith(MEDIA_QUEUE_HREF);
  const queueLabel = translate('media_queue_title', 'Render queue');
  const stripTabs = railTabs;

  if (permissions.isLoaded && !permissions.hasPermission('media', 'read')) {
    return (
      <div className="flex flex-1 items-center justify-center h-full p-[20px] bg-newBgColorInner text-textColor">
        <div className="text-center">
          <div className="text-[16px] font-semibold mb-2">
            {translate('media_access_required', 'Media access required')}
          </div>
          <div className="text-[13px] text-newTableText/60">
            {translate(
              'media_access_required_body',
              "You don't have permission to access media tools."
            )}
          </div>
        </div>
      </div>
    );
  }

  // Bound the section to the viewport (desktop) so the side rail matches the
  // fixed main menu's height and scrolls internally instead of growing the
  // page. Offset = outer p-12 (top+bottom) + the 80px app header = 104px.
  return (
    <div className="flex flex-1 h-[calc(100vh-104px)] mobile:h-auto min-w-0 gap-[15px] p-[20px] mobile:p-0 mobile:gap-0 bg-newBgColorInner">
      {/* Desktop side rail (collapsible). Hidden on mobile — replaced by the strip. */}
      <div
        className={clsx(
          'mobile:hidden shrink-0 flex flex-col gap-[4px] transition-all min-h-0',
          collapsed ? 'w-[56px]' : 'w-[220px]'
        )}
      >
        <div
          className={clsx(
            'flex items-center mb-[8px] px-[8px] h-[24px]',
            collapsed ? 'justify-center px-0' : 'justify-between'
          )}
        >
          {!collapsed && (
            <span className="text-[13px] font-[600] text-textColor">
              {translate('media_tools_heading', 'Media Tools')}
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={
              collapsed
                ? translate('expand_menu', 'Expand menu')
                : translate('collapse_menu', 'Collapse menu')
            }
            title={
              collapsed
                ? translate('expand_menu', 'Expand menu')
                : translate('collapse_menu', 'Collapse menu')
            }
            className="flex w-[24px] h-[24px] items-center justify-center rounded-[6px] text-textColor/60 hover:text-textColor hover:bg-newColColor/50 transition-colors"
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
          <Link
            href={MEDIA_QUEUE_HREF}
            title={queueLabel}
            aria-current={queueActive ? 'page' : undefined}
            className={clsx(
              'group/rail relative flex items-center gap-[10px] rounded-e-[6px] text-[13px] text-textColor transition-colors',
              collapsed ? 'justify-center px-[8px] py-[10px]' : 'ps-[10px] pe-[12px] py-[8px]',
              queueActive ? 'bg-boxHover' : 'hover:bg-boxHover'
            )}
          >
            <span
              className={clsx(
                'absolute start-0 top-1/2 -translate-y-1/2 h-[18px] w-[3px] rounded-e-[2px] bg-btnPrimary transition-opacity',
                queueActive ? 'opacity-100' : 'opacity-0 group-hover/rail:opacity-100',
                collapsed && 'hidden'
              )}
            />
            <span className="w-[18px] h-[18px] flex items-center justify-center shrink-0">
              <QueueIcon />
            </span>
            {!collapsed && <span className="truncate">{queueLabel}</span>}
          </Link>
          {railTabs.map((t, i) => {
            const active = pathname.startsWith(t.href);
            // 'Platform' (Designer) is the lone built-in tool — no section header.
            const showHeader =
              t.section !== 'Platform' &&
              (i === 0 || railTabs[i - 1].section !== t.section);
            return (
              <React.Fragment key={t.href}>
                {showHeader && (
                  <div
                    className={clsx(
                      'text-[10px] font-semibold text-newTableText uppercase tracking-wider px-[4px] mt-[12px] mb-[4px]',
                      collapsed && 'hidden'
                    )}
                  >
                    {MEDIA_SECTION_LABELS[t.section]
                      ? translate(
                          MEDIA_SECTION_LABELS[t.section].labelKey,
                          MEDIA_SECTION_LABELS[t.section].labelDefault
                        )
                      : t.section}
                  </div>
                )}
                <Link
                  href={t.href}
                  title={tabLabel(t)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'group/rail relative flex items-center gap-[10px] rounded-e-[6px] text-[13px] text-textColor transition-colors',
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
                    {t.icon}
                  </span>
                  {!collapsed && <span className="truncate">{tabLabel(t)}</span>}
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Page area: mobile gets a horizontal sub-menu strip above the content. */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <SubmenuStrip
          ariaLabel={translate('media_tools_aria_label', 'Media tools')}
          overflowLabel={translate('more_media_tools', 'More media tools')}
          items={[
            {
              href: MEDIA_QUEUE_HREF,
              label: queueLabel,
              icon: <QueueIcon />,
              active: queueActive,
            },
            // `section` was never passed here, so the overflow menu had nothing
            // to group 12-47 studios by.
            ...stripTabs.map((t) => ({
              href: t.href,
              label: tabLabel(t),
              icon: t.icon,
              section: MEDIA_SECTION_LABELS[t.section]
                ? translate(
                    MEDIA_SECTION_LABELS[t.section].labelKey,
                    MEDIA_SECTION_LABELS[t.section].labelDefault
                  )
                : t.section,
              active: pathname.startsWith(t.href),
            })),
          ]}
        />
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto mobile:overflow-visible">
          <StudioErrorBoundary>{children}</StudioErrorBoundary>
        </div>
      </div>
    </div>
  );
}
