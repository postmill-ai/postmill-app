import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: ({ src, alt, className }: any) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img src={src} alt={alt} className={className} />
  ),
}));

vi.mock('next/dynamic', () => ({
  default: (load: any) => {
    const Component = () => <div data-testid="mode">Mode</div>;
    Component.displayName = 'DynamicMode';
    return Component;
  },
}));

let mockUser: any = {
  id: 'u1',
  email: 'test@example.com',
  profile: { name: 'Test User' },
};

let mockPermissions = {
  isResolved: true,
  hasPermission: () => true,
};

vi.mock('../layout/user.context', () => ({
  useUser: () => mockUser,
}));

vi.mock('../layout/use-permissions', () => ({
  usePermissions: () => mockPermissions,
}));

vi.mock('../layout/language.component', () => ({
  LanguageMenuRow: ({ onOpen }: any) => (
    <button type="button" role="menuitem" onClick={onOpen}>
      Language
    </button>
  ),
}));

vi.mock('../layout/streak.component', () => ({
  StreakComponent: () => <div data-testid="streak">Streak</div>,
}));

vi.mock('../layout/organization.selector', () => ({
  OrganizationSelector: () => null,
}));

vi.mock('../layout/chrome.extension.component', () => ({
  ChromeExtensionComponent: () => null,
}));

vi.mock('./sentry.feedback.component', () => ({
  AttachToFeedbackIcon: () => null,
}));

import { UserAvatarMenu } from './user-avatar-menu';

describe('UserAvatarMenu', () => {
  beforeEach(() => {
    mockUser = {
      id: 'u1',
      email: 'test@example.com',
      profile: { name: 'Test User' },
    };
    mockPermissions = { isResolved: true, hasPermission: () => true };
  });

  it('renders the avatar trigger and opens the menu', () => {
    render(<UserAvatarMenu />);
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByText('Profile')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('Logout')).toBeDefined();
  });

  it('hides Settings when the user lacks settings:read', () => {
    mockPermissions = { isResolved: true, hasPermission: () => false };
    render(<UserAvatarMenu />);
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.queryByText('Settings')).toBeNull();
  });
});
