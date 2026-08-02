import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ profile: { name: 'Maya Chen' } }),
}));

vi.mock('@postmill-ai/frontend/components/layout/streak.component', () => ({
  StreakComponent: () => <div data-testid="streak" />,
}));

vi.mock('./customize.popover', () => ({
  CustomizePopover: () => <div data-testid="customize" />,
}));

import { DashboardHeader } from './dashboard.header';

beforeEach(() => {
  mockPush.mockClear();
});

describe('DashboardHeader', () => {
  it('starts a design without guessing which tool you wanted', () => {
    render(<DashboardHeader sections={[]} />);

    // Closed until asked for — the menu must not be in the initial DOM.
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByLabelText('New design'));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'AI Designer' }));
    expect(mockPush).toHaveBeenCalledWith('/media/ai-designer');
  });

  it('routes the manual path at the Designer', () => {
    render(<DashboardHeader sections={[]} />);

    fireEvent.click(screen.getByLabelText('New design'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Designer' }));

    expect(mockPush).toHaveBeenCalledWith('/media/designer');
  });

  it('closes the menu on Escape', () => {
    render(<DashboardHeader sections={[]} />);

    fireEvent.click(screen.getByLabelText('New design'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the campaign create modal rather than the bare list', () => {
    render(<DashboardHeader sections={[]} />);

    fireEvent.click(screen.getByLabelText('New campaign'));

    expect(mockPush).toHaveBeenCalledWith('/campaigns?new=1');
  });

  it('shows the Daily Brief button only once AI is known to be active', () => {
    const { rerender } = render(<DashboardHeader sections={[]} />);
    expect(screen.queryByLabelText('Daily brief')).toBeNull();

    rerender(<DashboardHeader sections={[]} showBriefButton />);
    expect(screen.getByLabelText('Daily brief')).toBeTruthy();
  });
});
