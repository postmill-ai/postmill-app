import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomizePopover } from './customize.popover';

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

describe('CustomizePopover', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPermissions.isResolved = true;
    mockPermissions.hasPermission.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sections = [
    { id: 'kpi', label: 'KPIs' },
    { id: 'usage', label: 'Usage', permission: ['billing', 'read'] as [string, string] },
    { id: 'media', label: 'Media', permission: ['media', 'read'] as [string, string] },
  ];

  it('toggling a section persists to localStorage', async () => {
    mockPermissions.hasPermission.mockReturnValue(true);

    render(<CustomizePopover sections={sections} />);
    fireEvent.click(screen.getByLabelText('Customize dashboard'));

    const kpiSwitch = await screen.findByRole('switch', { name: 'KPIs' });
    expect(kpiSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(kpiSwitch);
    await waitFor(() => {
      expect(localStorage.getItem('dashboard_prefs')).toEqual(
        JSON.stringify({ hidden: ['kpi'], v: 1 })
      );
    });

    fireEvent.click(kpiSwitch);
    await waitFor(() => {
      expect(localStorage.getItem('dashboard_prefs')).toEqual(
        JSON.stringify({ hidden: [], v: 1 })
      );
    });
  });

  it('hides sections whose permission the user lacks', async () => {
    mockPermissions.hasPermission.mockImplementation(
      (resource: string) => resource === 'billing'
    );

    render(<CustomizePopover sections={sections} />);
    fireEvent.click(screen.getByLabelText('Customize dashboard'));

    expect(await screen.findByText('KPIs')).toBeTruthy();
    expect(screen.getByText('Usage')).toBeTruthy();
    expect(screen.queryByText('Media')).toBeNull();
  });

  it('renders optimistically while permissions are loading', async () => {
    mockPermissions.isResolved = false;
    mockPermissions.hasPermission.mockReturnValue(false);

    render(<CustomizePopover sections={sections} />);
    fireEvent.click(screen.getByLabelText('Customize dashboard'));

    // All sections should be visible while the permission fetch is in flight.
    expect(await screen.findByText('KPIs')).toBeTruthy();
    expect(screen.getByText('Usage')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
  });
});
