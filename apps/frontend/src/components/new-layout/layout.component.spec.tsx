import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const mockT = vi.fn((_key: string, fallback?: string, opts?: Record<string, any>) => {
  if (!fallback) return _key;
  if (opts?.count !== undefined) return fallback.replace('{{count}}', String(opts.count));
  return fallback;
});

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('next/font/google', () => ({
  Plus_Jakarta_Sans: () => ({ className: 'mocked-font' }),
}));

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: mockReplace }),
}));

// The response `/user/self` resolves to. Tests that exercise the real loader swap this
// for a non-2xx response (the throttler's 429 body) — see the throttling describe below.
let mockUserResponse: any = {
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      picture: null,
    }),
};

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn().mockImplementation(() => Promise.resolve(mockUserResponse)),
}));

const stubbedUser = {
  id: 'test-user',
  name: 'Test User',
  email: 'test@example.com',
  picture: null,
  tier: { current: 'PRO' },
  setupCompleted: true,
};

// By default useSWR is stubbed out entirely (these tests are about the header chrome).
// `useRealSwr` flips it to a minimal implementation that actually runs the fetcher, so
// the `/user/self` loader — and its non-2xx handling — is under test.
let useRealSwr = false;

const swrStub = (_key: string, _fetcher: any) => ({
  data: stubbedUser,
  error: undefined,
  mutate: vi.fn(),
});

vi.mock('swr', () => ({
  // Named `use…` so react-hooks/rules-of-hooks treats the body as a hook; a
  // function expression so the mock factory stays self-contained (vi.mock is
  // hoisted above module scope). The useRealSwr check moved inside: the flag is
  // set per test before render, so reading it at call time is safe.
  default: function useMockSwr(key: string, fetcher: any) {
    const [state, setState] = React.useState<{ data?: any; error?: any }>({});
    React.useEffect(() => {
      if (!useRealSwr) return;
      let cancelled = false;
      Promise.resolve(fetcher(key)).then(
        (data) => !cancelled && setState({ data }),
        (error) => !cancelled && setState({ error })
      );
      return () => {
        cancelled = true;
      };
    }, [key, fetcher]);
    if (!useRealSwr) return swrStub(key, fetcher);
    return { data: state.data, error: state.error, mutate: vi.fn() };
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
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

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
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

vi.mock('@postmill-ai/react/helpers/mantine.wrapper', () => ({
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
    useRealSwr = false;
    mockReplace.mockClear();
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
    // Logout is a BUTTON running the canonical logout flow (session revoke +
    // /auth/logout) — the old href="/logout" pointed at a nonexistent route.
    const logoutItem = menuItems.find(
      (l) => l.tagName === 'BUTTON' && /logout/i.test(l.textContent || '')
    );

    expect(profileLink).toBeDefined();
    expect(settingsLink).toBeDefined();
    expect(logoutItem).toBeDefined();

    const linkOrder = menuItems.indexOf(profileLink!) < menuItems.indexOf(settingsLink!);
    expect(linkOrder).toBe(true);
    expect(menuItems.indexOf(settingsLink!)).toBeLessThan(menuItems.indexOf(logoutItem!));
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

// C4: a throttled `/user/self` used to be parsed as the user object, leaving
// `setupCompleted` undefined and bouncing a perfectly healthy user to /setup.
describe('LayoutComponent throttling (C4)', () => {
  beforeEach(() => {
    useRealSwr = true;
    mockReplace.mockClear();
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

  afterEach(() => {
    useRealSwr = false;
    mockUserResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...stubbedUser }),
    };
  });

  it('does not redirect to /setup when /user/self is throttled', async () => {
    mockUserResponse = {
      ok: false,
      status: 429,
      json: () =>
        Promise.resolve({
          statusCode: 429,
          message: 'ThrottlerException: Too Many Requests',
        }),
    };

    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    // The 429 body must never be mistaken for a user; instead of navigating, the layout
    // surfaces a retry affordance.
    await waitFor(() => {
      expect(
        screen.getByText('We could not load your account. Please try again.')
      ).toBeDefined();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('renders the app normally when /user/self succeeds', async () => {
    mockUserResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...stubbedUser }),
    };

    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    await waitFor(() => {
      expect(screen.getByText('Child Content')).toBeDefined();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects to /setup only for a genuine incomplete-setup user', async () => {
    mockUserResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...stubbedUser, setupCompleted: false }),
    };

    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/setup');
    });
  });

  it('does not blank the page forever when the role lookup fails', async () => {
    // usePermissions throws on a non-2xx (e.g. a throttled /settings/roles/me), so
    // `isResolved` never flips. Gating on `isLoaded` lets the app render anyway.
    mockPermissions = {
      isLoaded: true,
      isResolved: false,
      role: null,
      isSuperAdmin: false,
      isOwner: false,
      isAdmin: false,
      hasPermission: () => false,
      refresh: vi.fn(),
    };
    mockUserResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...stubbedUser, setupCompleted: false }),
    };

    render(
      <LayoutComponent>
        <div>Child Content</div>
      </LayoutComponent>
    );

    await waitFor(() => {
      expect(screen.getByText('Child Content')).toBeDefined();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
