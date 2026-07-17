import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockIntegrations: any[] = [];
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => ({ data: mockIntegrations }),
  })
);

let mockSummary: any = {};
vi.mock('./hooks/useDashboardSummary', () => ({
  useDashboardSummary: () => ({ data: mockSummary }),
}));

vi.mock('@gitroom/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: true, hasPermission: () => true }),
}));

// Explicit extension: stray compiled `dashboard.setup.js` artifacts in this
// directory would otherwise shadow the .tsx source under Vite's resolve order.
import { DashboardSetup } from './dashboard.setup.tsx';

const emptySummary = () => ({
  aiProviderActive: false,
  mediaProviderActive: false,
  storageProviderActive: false,
  teamMembers: 1,
  totalPosts: 0,
});

const stepLabel = (key: string) =>
  ({
    channel: 'Connect a Social Channel',
    ai: 'Connect an AI (LLM) Provider',
    media: 'Connect an AI Media Provider',
    storage: 'Connect a Storage Provider',
    team: 'Invite a Team Member',
    post: 'Create your First Post',
  }[key]!);

const isStepDone = (key: string) => {
  const label = screen.getByText(stepLabel(key));
  return label.className.includes('line-through');
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockIntegrations = [];
  mockSummary = emptySummary();
});

describe('DashboardSetup (Part G)', () => {
  it('shows all six steps incomplete with empty data and 0/6 progress', () => {
    render(<DashboardSetup />);

    expect(screen.getByText('Welcome to Postmill')).toBeTruthy();
    expect(screen.getByText('0/6')).toBeTruthy();
    for (const key of ['channel', 'ai', 'storage', 'media', 'team', 'post']) {
      expect(isStepDone(key)).toBe(false);
    }
  });

  it('completes "channel" when integrations exist', () => {
    mockIntegrations = [{ id: 'int-1' }];
    render(<DashboardSetup />);

    expect(isStepDone('channel')).toBe(true);
    expect(screen.getByText('1/6')).toBeTruthy();
  });

  it('completes "post" when summary.totalPosts > 0 (regression: was hard-coded false)', () => {
    mockSummary = { ...emptySummary(), totalPosts: 3 };
    render(<DashboardSetup />);

    expect(isStepDone('post')).toBe(true);
    expect(screen.getByText('1/6')).toBeTruthy();
  });

  it('completes "ai" when summary.aiProviderActive is true', () => {
    mockSummary = { ...emptySummary(), aiProviderActive: true };
    render(<DashboardSetup />);

    expect(isStepDone('ai')).toBe(true);
  });

  it('completes "storage" when summary.storageProviderActive is true', () => {
    mockSummary = { ...emptySummary(), storageProviderActive: true };
    render(<DashboardSetup />);

    expect(isStepDone('storage')).toBe(true);
  });

  it('completes "media" when summary.mediaProviderActive is true', () => {
    mockSummary = { ...emptySummary(), mediaProviderActive: true };
    render(<DashboardSetup />);

    expect(isStepDone('media')).toBe(true);
  });

  it('completes "team" only when teamMembers > 1', () => {
    mockSummary = { ...emptySummary(), teamMembers: 1 };
    const { unmount } = render(<DashboardSetup />);
    expect(isStepDone('team')).toBe(false);
    unmount();

    mockSummary = { ...emptySummary(), teamMembers: 2 };
    render(<DashboardSetup />);
    expect(isStepDone('team')).toBe(true);
  });

  it('reports correct progress count for a partial mix', () => {
    mockIntegrations = [{ id: 'int-1' }];
    mockSummary = {
      ...emptySummary(),
      aiProviderActive: true,
      totalPosts: 5,
    };
    render(<DashboardSetup />);

    expect(screen.getByText('3/6')).toBeTruthy();
    expect(isStepDone('channel')).toBe(true);
    expect(isStepDone('ai')).toBe(true);
    expect(isStepDone('post')).toBe(true);
    expect(isStepDone('storage')).toBe(false);
    expect(isStepDone('media')).toBe(false);
    expect(isStepDone('team')).toBe(false);
  });

  it('auto-hides when all six steps are complete', () => {
    mockIntegrations = [{ id: 'int-1' }];
    mockSummary = {
      aiProviderActive: true,
      mediaProviderActive: true,
      storageProviderActive: true,
      teamMembers: 3,
      totalPosts: 10,
    };
    const { container } = render(<DashboardSetup />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Welcome to Postmill')).toBeNull();
  });

  it('dismiss persists to localStorage and hides the panel', () => {
    const { container } = render(<DashboardSetup />);

    expect(screen.getByText('Welcome to Postmill')).toBeTruthy();
    fireEvent.click(screen.getByText('Dismiss'));

    expect(localStorage.getItem('onboarding_dismissed')).toBe('true');
    expect(container.firstChild).toBeNull();
  });

  it('stays hidden on mount when onboarding_dismissed is already set', () => {
    localStorage.setItem('onboarding_dismissed', 'true');
    const { container } = render(<DashboardSetup />);

    expect(container.firstChild).toBeNull();
  });

  it('navigates to the step href when an incomplete step is clicked', () => {
    render(<DashboardSetup />);

    fireEvent.click(screen.getByText(stepLabel('channel')));
    expect(mockPush).toHaveBeenCalledWith('/settings/channels');
  });

  it('does not navigate when a completed step is clicked', () => {
    mockIntegrations = [{ id: 'int-1' }];
    render(<DashboardSetup />);

    fireEvent.click(screen.getByText(stepLabel('channel')));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
