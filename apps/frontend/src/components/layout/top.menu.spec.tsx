import { render, screen, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockIsGeneral = true;
let mockBillingEnabled = false;
let mockPathname = '/dashboard';

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isGeneral: mockIsGeneral, billingEnabled: mockBillingEnabled }),
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

import { TopMenu, useMenuItem } from './top.menu';

describe('TopMenu', () => {
  describe('Posts rename (was Schedule/Launches)', () => {
    beforeEach(() => {
      mockBillingEnabled = false;
    });

    it('in general mode, the menu item name should be "Posts"', () => {
      mockIsGeneral = true;
      render(<TopMenu />);

      expect(screen.getByTitle('Posts')).toBeDefined();
    });

    it('in general mode, the menu item path should be "/posts"', () => {
      mockIsGeneral = true;
      render(<TopMenu />);

      const postsLink = screen.getByTitle('Posts');
      expect(postsLink.getAttribute('href')).toBe('/posts');
    });

    it('in non-general mode, the label should be "Launches"', () => {
      mockIsGeneral = false;
      render(<TopMenu />);

      expect(screen.getByTitle('Launches')).toBeDefined();
    });
  });

  describe('R5 settings gating', () => {
    beforeEach(() => {
      mockIsGeneral = true;
      mockBillingEnabled = false;
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

    it('shows Settings for members with settings:read', () => {
      render(<TopMenu />);
      expect(screen.getByTitle('Settings')).toBeDefined();
    });

    it('hides Settings for members lacking settings:read', () => {
      mockPermissions.hasPermission = () => false;
      mockPermissions.isOwner = false;
      mockPermissions.isAdmin = false;
      mockPermissions.role = 'viewer';
      render(<TopMenu />);
      expect(screen.queryByTitle('Settings')).toBeNull();
    });

    it('shows Settings optimistically while permissions load (no flash)', () => {
      mockPermissions.isResolved = false;
      mockPermissions.isLoaded = false;
      mockPermissions.hasPermission = () => false;
      render(<TopMenu />);
      expect(screen.getByTitle('Settings')).toBeDefined();
    });
  });

  describe('Home navigation (2.4)', () => {
    beforeEach(() => {
      mockIsGeneral = true;
      mockBillingEnabled = false;
      mockPathname = '/dashboard';
    });

    it('pins Home first in firstMenu', () => {
      const { result } = renderHook(() => useMenuItem());
      expect(result.current.firstMenu[0].path).toBe('/dashboard');
      expect(result.current.firstMenu[0].name).toBe('Home');
    });

    it('keeps the remaining firstMenu items sorted alphabetically', () => {
      const { result } = renderHook(() => useMenuItem());
      const remaining = result.current.firstMenu.slice(1).map((i) => i.name);
      expect(remaining).toEqual([...remaining].sort((a, b) => a.localeCompare(b)));
    });

    it('highlights Home as active on /dashboard', () => {
      mockPathname = '/dashboard';
      render(<TopMenu />);
      const homeLink = screen.getByTitle('Home');
      expect(homeLink.className).toContain('bg-boxFocused');
    });
  });
});
