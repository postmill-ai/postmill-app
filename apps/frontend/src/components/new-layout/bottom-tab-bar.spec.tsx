import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockIsGeneral = true;
let mockBillingEnabled = false;
let mockPathname = '/dashboard';

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: mockIsGeneral,
    billingEnabled: mockBillingEnabled,
  }),
}));

const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({
    id: 'test-user',
    orgId: 'test-org',
    role: 'USER',
    tier: 'PRO',
  }),
  ContextWrapper: ({ children }: any) => children,
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
  ModalWrapper: ({ children }: any) => children,
  useHasOpenModals: () => false,
}));

vi.mock('@gitroom/frontend/components/layout/agent.media.modal', () => ({
  AgentMediaModal: () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname || '/dashboard',
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

vi.mock('@gitroom/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => mockPermissions,
}));

import { BottomTabBar } from './bottom-tab-bar';

describe('BottomTabBar', () => {
  beforeEach(() => {
    mockIsGeneral = true;
    mockBillingEnabled = false;
    mockPathname = '/analytics';
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

  const getPrimaryLinks = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('nav a'));

  it('pins Home as the first primary tab', () => {
    const { container } = render(<BottomTabBar />);
    const links = getPrimaryLinks(container);

    expect(links[0].getAttribute('href')).toBe('/dashboard');
    expect(links[0].textContent).toContain('Home');
  });

  it('keeps Analytics, Campaigns and Media as primary tabs after Home', () => {
    const { container } = render(<BottomTabBar />);
    const hrefs = getPrimaryLinks(container).map((l) => l.getAttribute('href'));

    expect(hrefs).toEqual([
      '/dashboard',
      '/analytics',
      '/campaigns',
      '/media',
    ]);
  });

  it('highlights Home as active on /dashboard', () => {
    mockPathname = '/dashboard';
    const { container } = render(<BottomTabBar />);
    const homeLink = getPrimaryLinks(container)[0];

    expect(homeLink.className).toContain('text-btnPrimary');
  });
});
