import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const mockT = vi.fn((_key: string, fallback?: string, opts?: Record<string, any>) => {
  if (!fallback) return _key;
  if (opts?.count !== undefined) return fallback.replace('{{count}}', String(opts.count));
  return fallback;
});

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('next/font/google', () => ({
  Plus_Jakarta_Sans: () => ({ className: 'mocked-font' }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () =>
    vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          id: 'test-user',
          name: 'Test User',
          email: 'test@example.com',
          picture: null,
        }),
    }),
}));

vi.mock('swr', () => ({
  default: (key: string, fetcher: any) => ({
    data: {
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      picture: null,
      tier: { current: 'PRO' },
      setupCompleted: true,
    },
    mutate: vi.fn(),
  }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ billingEnabled: false, isGeneral: true, sentryDsn: '' }),
}));

vi.mock('../layout/user.context', () => ({
  useUser: () => ({
    id: 'test-user',
    name: 'Test User',
    email: 'test@example.com',
    picture: null,
    tier: { current: 'PRO' },
    setupCompleted: true,
  }),
  ContextWrapper: ({ children }: any) => children,
}));

vi.mock('../layout/title', () => ({
  Title: () => <div>Test Title</div>,
}));

vi.mock('../layout/top.menu', () => ({
  TopMenu: () => <div>Top Menu</div>,
  useMenuItem: () => ({ all: [], firstMenu: [], secondMenu: [] }),
}));

vi.mock('../layout/language.component', () => ({
  LanguageComponent: () => <div data-testid="language">Lang</div>,
  // Language now lives as a row inside the avatar dropdown (not in the header).
  LanguageMenuRow: ({ onOpen }: any) => (
    <button
      type="button"
      role="menuitem"
      data-testid="language-menu"
      onClick={onOpen}
    >
      Language
    </button>
  ),
}));

vi.mock('../layout/chrome.extension.component', () => ({
  ChromeExtensionComponent: () => <div data-testid="chrome-ext">Chrome</div>,
}));

// CreateMenu ("+" dropdown) deps — kept inert; the dropdown is closed in these tests.
vi.mock('../layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: vi.fn() }),
  // BottomTabBar reads this to hide itself while a modal is open; no modals in these tests.
  useHasOpenModals: () => false,
}));

vi.mock('../launches/add.provider.component', () => ({
  useAddProvider: () => vi.fn(),
}));

vi.mock('../layout/mode.component', () => ({
  default: () => <div data-testid="mode">Mode</div>,
}));

vi.mock('../layout/streak.component', () => ({
  StreakComponent: () => <div data-testid="streak">Streak</div>,
}));

vi.mock('../layout/organization.selector', () => ({
  OrganizationSelector: () => null,
}));

vi.mock('./logo', () => ({
  Logo: () => <div>Logo</div>,
}));

vi.mock('./sentry.feedback.component', () => ({
  AttachToFeedbackIcon: () => <div data-testid="feedback">Feedback</div>,
}));

vi.mock('../notifications/notification.component', () => ({
  default: () => <div data-testid="notifications">Notifications</div>,
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  Toaster: () => null,
}));

vi.mock('../layout/top.tip', () => ({
  ToolTip: () => null,
}));

vi.mock('../layout/check.payment', () => ({
  CheckPayment: ({ children }: any) => children,
}));

vi.mock('../files/file.component', () => ({
  MultiFileComponent: () => null,
  FileComponent: () => null,
}));

vi.mock('../launches/helpers/linkedin.component', () => ({
  ShowLinkedinCompany: () => null,
}));

vi.mock('../launches/helpers/media.settings.component', () => ({
  MediaSettingsLayout: () => null,
}));

vi.mock('../post-url-selector/post.url.selector', () => ({
  ShowPostSelector: () => null,
}));

vi.mock('../layout/new.subscription', () => ({
  NewSubscription: () => null,
}));

vi.mock('../layout/support', () => ({
  Support: () => null,
}));

vi.mock('../layout/continue.provider', () => ({
  ContinueProvider: () => null,
}));

vi.mock('../layout/copilot.provider', () => ({
  CopilotProvider: ({ children }: any) => children,
}));

vi.mock('@gitroom/react/helpers/mantine.wrapper', () => ({
  MantineWrapper: ({ children }: any) => children,
}));

vi.mock('../layout/announcement.banner', () => ({
  AnnouncementBanner: () => null,
}));

vi.mock('../layout/gtm.component', () => ({
  TrialTracker: () => null,
}));

vi.mock('../layout/pre-condition.component', () => ({
  PreConditionComponent: () => null,
}));

vi.mock('../billing/first.billing.component', () => ({
  FirstBillingComponent: () => null,
}));

let mockPermissions = {
  isLoaded: true,
  isResolved: true,
  role: 'owner' as string | null,
  isSuperAdmin: false,
  isOwner: true,
  isAdmin: true,
  hasPermission: (_resource: string, _action: string) => true,
  refresh: vi.fn(),
};

vi.mock('../layout/use-permissions', () => ({
  usePermissions: () => mockPermissions,
}));

import { LayoutComponent } from './layout.component';

describe('LayoutComponent header', () => {
  beforeEach(() => {
    mockPermissions = {
      isLoaded: true,
      isResolved: true,
      role: 'owner',
      isSuperAdmin: false,
      isOwner: true,
      isAdmin: true,
      hasPermission: () => true,
      refresh: vi.fn(),
    };
  });

  it('renders header icons without SettingsComponent gear', () => {
    const { container } = render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    expect(screen.getByTestId('streak')).toBeDefined();
    expect(screen.getByTestId('chrome-ext')).toBeDefined();
    expect(screen.getByTestId('feedback')).toBeDefined();
    expect(screen.getByTestId('notifications')).toBeDefined();

    // "+" create menu sits in the header (left of the dark/light toggle); its items
    // (New Post, etc.) live in the dropdown, which is closed here.
    expect(screen.getByRole('button', { name: 'Create new' })).toBeDefined();
    expect(container.querySelector('a[href="/posts/post"]')).toBeNull();
    // Language moved out of the header into the avatar dropdown (closed here).
    expect(screen.queryByTestId('language')).toBeNull();

    const settingSvg = container.querySelector('svg[width="40"][height="40"]');
    expect(settingSvg).toBeNull();
  });

  it('avatar menu renders Profile, Settings, Logout in order when clicked', () => {
    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.click(avatarButton);

    const menuItems = screen.getAllByRole('menuitem');
    const profileLink = menuItems.find((l) => l.getAttribute('href') === '/user/me');
    const settingsLink = menuItems.find((l) => l.getAttribute('href') === '/settings');
    const logoutLink = menuItems.find((l) => l.getAttribute('href') === '/logout');

    expect(profileLink).toBeDefined();
    expect(settingsLink).toBeDefined();
    expect(logoutLink).toBeDefined();

    const avatarLinks = [profileLink!, settingsLink!, logoutLink!];
    const linkOrder = menuItems.indexOf(profileLink!) < menuItems.indexOf(settingsLink!);
    expect(linkOrder).toBe(true);
    expect(menuItems.indexOf(settingsLink!)).toBeLessThan(menuItems.indexOf(logoutLink!));
  });

  it('avatar menu uses translated labels via useT (L4)', () => {
    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.click(avatarButton);

    expect(mockT).toHaveBeenCalledWith('profile', 'Profile');
    expect(mockT).toHaveBeenCalledWith('settings', 'Settings');
    expect(mockT).toHaveBeenCalledWith('logout', 'Logout');
  });

  it('trigger button exposes aria-expanded and aria-haspopup (U9)', () => {
    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    expect(avatarButton.getAttribute('aria-haspopup')).toBe('true');

    expect(avatarButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(avatarButton);
    expect(avatarButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('avatar menu items have role=menuitem and dropdown has role=menu (U9)', () => {
    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.click(avatarButton);

    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeDefined();

    // Profile, Settings, Language, Documentation, Logout.
    const menuItems = document.querySelectorAll('[role="menuitem"]');
    expect(menuItems.length).toBe(5);
  });

  it('R5: hides the Settings menu item for members lacking settings:read', () => {
    mockPermissions.hasPermission = () => false;
    mockPermissions.isOwner = false;
    mockPermissions.isAdmin = false;
    mockPermissions.role = 'viewer';

    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.click(avatarButton);

    const menuItems = screen.getAllByRole('menuitem');
    const settingsLink = menuItems.find(
      (l) => l.getAttribute('href') === '/settings'
    );
    expect(settingsLink).toBeUndefined();
    // Profile, Language, Documentation, Logout (Settings hidden).
    expect(menuItems.length).toBe(4);
  });

  it('R5: keeps Settings visible while permissions load (no flash)', () => {
    mockPermissions.isResolved = false;
    mockPermissions.isLoaded = false;
    mockPermissions.hasPermission = () => false;

    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.click(avatarButton);

    const menuItems = screen.getAllByRole('menuitem');
    const settingsLink = menuItems.find(
      (l) => l.getAttribute('href') === '/settings'
    );
    expect(settingsLink).toBeDefined();
  });

  it('pressing Escape closes the avatar menu (U9)', () => {
    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    const avatarButton = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.click(avatarButton);
    expect(avatarButton.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(avatarButton.getAttribute('aria-expanded')).toBe('false');
  });
});
