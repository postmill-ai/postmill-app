import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionCard } from './section-card';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockPermissions = {
  isResolved: true,
  hasPermission: vi.fn(),
};

vi.mock('@gitroom/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => mockPermissions,
}));

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('boom');
  }
  return <div>safe</div>;
}

describe('SectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPermissions.isResolved = true;
    mockPermissions.hasPermission.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders title, icon, badge, children, and view-all link', () => {
    render(
      <SectionCard
        id="test"
        title="Test Section"
        icon={<svg data-testid="icon" />}
        badge={5}
        viewAllHref="/test"
      >
        <div data-testid="child">child content</div>
      </SectionCard>
    );

    expect(screen.getByText('Test Section')).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('View all').getAttribute('href')).toBe('/test');
  });

  it('returns null when its id is hidden in dashboard_prefs', () => {
    localStorage.setItem('dashboard_prefs', JSON.stringify({ hidden: ['test'], v: 1 }));
    const { container } = render(
      <SectionCard id="test" title="Test">
        <div>child</div>
      </SectionCard>
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null for badge when badge is zero or undefined', () => {
    render(
      <SectionCard id="test" title="Test">
        <div>child</div>
      </SectionCard>
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows the ErrorBoundary fallback when a child throws', () => {
    render(
      <SectionCard id="test" title="Test">
        <Bomb shouldThrow={true} />
      </SectionCard>
    );

    expect(screen.getByText('This section failed to load')).toBeTruthy();
  });

  it('hides the section when the user lacks the required permission', () => {
    mockPermissions.hasPermission.mockReturnValue(false);

    const { container } = render(
      <SectionCard id="test" title="Test" permission={['billing', 'read']}>
        <div>child</div>
      </SectionCard>
    );

    expect(container.firstChild).toBeNull();
    expect(mockPermissions.hasPermission).toHaveBeenCalledWith('billing', 'read');
  });

  it('renders optimistically while permissions are still loading', () => {
    mockPermissions.isResolved = false;
    mockPermissions.hasPermission.mockReturnValue(false);

    render(
      <SectionCard id="test" title="Test" permission={['billing', 'read']}>
        <div>child</div>
      </SectionCard>
    );

    expect(screen.getByText('child')).toBeTruthy();
  });
});
