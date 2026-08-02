import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';

import type { DashboardSummary } from '@postmill-ai/frontend/components/dashboard/hooks/useDashboardSummary';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), fallback)
      : fallback,
}));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({
    tier: { team_members: 5, brand_kits: 1, api: true, webhooks: true, campaigns: true },
  }),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isResolved: true }),
}));
vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({ isGeneral: true, billingEnabled: true }),
}));

let summary: Partial<DashboardSummary> | undefined;
vi.mock('@postmill-ai/frontend/components/dashboard/hooks/useDashboardSummary', () => ({
  useDashboardSummary: () => ({ data: summary }),
}));

import { SettingsIndexComponent } from './settings-index';

const base: Partial<DashboardSummary> = {
  channelsConnected: 4,
  aiProviderActive: true,
  mediaProviderActive: true,
  storageProviderActive: true,
  teamMembers: 3,
};

const renderIndex = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SettingsIndexComponent />
    </SWRConfig>
  );

beforeEach(() => {
  summary = { ...base };
});
afterEach(cleanup);

describe('SettingsIndexComponent', () => {
  it('renders a card per visible nav item, linking to its section', () => {
    renderIndex();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/settings/channels');
    expect(hrefs).toContain('/settings/storage');
    expect(hrefs).toContain('/settings/webhooks');
    // The campaigns shortcut deliberately leaves the settings surface.
    expect(hrefs).toContain('/campaigns');
  });

  it('reuses the nav copy verbatim rather than inventing new strings', () => {
    renderIndex();
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
  });

  it('labels the grouped sections', () => {
    renderIndex();
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Automation')).toBeTruthy();
    expect(screen.getByText('Developer')).toBeTruthy();
  });

  it('shows live counts when the workspace is set up', () => {
    renderIndex();
    expect(screen.getByText('4 connected')).toBeTruthy();
    expect(screen.getByText('3 members')).toBeTruthy();
    expect(screen.getByText('Cloud provider active')).toBeTruthy();
  });

  it('flags the sections that are not set up', () => {
    summary = { ...base, channelsConnected: 0, aiProviderActive: false, mediaProviderActive: false };
    renderIndex();

    expect(screen.getByText('None connected')).toBeTruthy();
    expect(screen.getAllByText('Not set up')).toHaveLength(2);
  });

  it('treats local storage as a working configuration, not a gap', () => {
    summary = { ...base, storageProviderActive: false };
    renderIndex();

    expect(screen.getByText('Local storage')).toBeTruthy();
    expect(screen.queryByText('Cloud provider active')).toBeNull();
  });

  it('reads a single-member workspace as neutral', () => {
    summary = { ...base, teamMembers: 1 };
    renderIndex();
    expect(screen.getByText('Just you')).toBeTruthy();
  });

  it('renders cards without status lines until the summary arrives', () => {
    summary = undefined;
    renderIndex();

    // Cards still render — the page is navigable before the one request lands.
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.queryByText('4 connected')).toBeNull();
    expect(screen.queryByText('None connected')).toBeNull();
  });
});
