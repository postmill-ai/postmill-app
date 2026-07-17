'use client';

import { FC, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useHasOpenModals } from '@gitroom/frontend/components/layout/new-modal';
import { MenuItemRow } from './menu-item-row';

// Primary destinations pinned to the bottom bar. Home is always first; the remaining
// primary items are rendered alphabetically (Analytics, Campaigns, Media). Everything
// else — including Schedule — goes into the "More" sheet.
const PRIMARY_PATHS = ['/dashboard', '/analytics', '/campaigns', '/media'];

const MoreIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

// Mobile-only bottom tab bar: 4 primary tabs + a "More" tab that opens a sheet
// with every remaining nav item. Reuses useMenuItem() so the items, icons and
// permission/billing gating stay in one place.
export const BottomTabBar: FC = () => {
  const { firstMenu, secondMenu } = useMenuItem();
  const { billingEnabled } = useVariables();
  const user = useUser();
  const t = useT();
  const pathname = usePathname();
  const hasOpenModals = useHasOpenModals();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet whenever the route changes (derived-state-during-render —
  // https://react.dev/learn/you-might-not-need-an-effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (moreOpen) setMoreOpen(false);
  }

  // Hide the bar while a modal is open so a full-screen modal's footer isn't covered.
  if (hasOpenModals) return null;

  const visible = (f: { hide?: boolean; requireBilling?: boolean }) =>
    !f.hide && !(f.requireBilling && !billingEnabled);

  // Apply the same Billing -> Lifetime relabel/path swap as the desktop menu.
  const resolve = (item: any) => {
    const isLifetimeBilling = item.name === 'Billing' && (user as any)?.isLifetime;
    return {
      ...item,
      path: isLifetimeBilling ? '/billing/lifetime' : item.path,
      name: isLifetimeBilling ? t('lifetime', 'Lifetime') : item.name,
    };
  };

  const all = [...firstMenu, ...secondMenu].filter(visible).map(resolve);
  const primary = (PRIMARY_PATHS.map((p) => all.find((i) => i.path === p)).filter(
    Boolean
  ) as any[]).sort((a, b) => a.name.localeCompare(b.name));
  const homePrimaryIndex = primary.findIndex((i) => i.path === '/dashboard');
  if (homePrimaryIndex > 0) {
    const [home] = primary.splice(homePrimaryIndex, 1);
    primary.unshift(home);
  }
  const primaryPaths = new Set(primary.map((i) => i.path));
  const rest = all.filter((i) => !primaryPaths.has(i.path));

  const isActive = (path: string) => path !== '#' && pathname.indexOf(path) === 0;

  return (
    <>
      <nav
        className="hidden mobile:flex fixed bottom-0 inset-x-0 z-[200] bg-newBgColorInner border-t border-newTableBorder pb-[env(safe-area-inset-bottom)]"
        aria-label={t('primary', 'Primary')}
      >
        <div className="flex flex-1 items-stretch h-[60px]">
          {primary.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={clsx(
                'flex flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-[600] min-w-0',
                isActive(item.path)
                  ? 'text-btnPrimary'
                  : 'text-textItemBlur hover:text-newTextColor'
              )}
            >
              <span className="w-[22px] h-[22px] flex items-center justify-center">
                {item.icon}
              </span>
              <span className="leading-none truncate max-w-full px-[2px]">
                {item.name}
              </span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            aria-haspopup="true"
            className={clsx(
              'flex flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-[600]',
              moreOpen ? 'text-btnPrimary' : 'text-textItemBlur hover:text-newTextColor'
            )}
          >
            <span className="w-[22px] h-[22px] flex items-center justify-center">
              {MoreIcon}
            </span>
            <span className="leading-none">{t('more', 'More')}</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="mobile:block hidden fixed inset-0 z-[210]">
          <button
            type="button"
            aria-label={t('close_menu', 'Close menu')}
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute bottom-0 inset-x-0 max-h-[78vh] overflow-y-auto bg-newBgColorInner rounded-t-[16px] p-[12px] pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
            <div className="mx-auto mb-[10px] h-[4px] w-[40px] rounded-full bg-newTableBorder" />
            <div className="flex flex-col gap-[2px]">
              {rest.map((item) => (
                <MenuItemRow
                  key={item.path + item.name}
                  label={item.name}
                  icon={item.icon}
                  path={item.onClick ? undefined : item.path}
                  onClick={
                    item.onClick
                      ? () => {
                          setMoreOpen(false);
                          item.onClick();
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
