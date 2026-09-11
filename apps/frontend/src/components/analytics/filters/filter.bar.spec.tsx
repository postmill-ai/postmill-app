import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (k: string, fallback?: string) => fallback || k,
}));

vi.mock(
  '@postmill-ai/frontend/components/launches/channel-filter-select',
  () => ({ ChannelFilterSelect: () => <div /> })
);
vi.mock(
  '@postmill-ai/frontend/components/launches/campaign-filter-select',
  () => ({ CampaignFilterSelect: () => <div /> })
);

// window.matchMedia shim lives in apps/frontend/vitest.setup.ts (Mantine's
// use-color-scheme media queries need it).

import { AnalyticsFilterBar } from './filter.bar';

// Must track the component's defaultRange() (today-30d → today): hardcoded
// dates make the "date" chip appear as soon as real time moves past them,
// which changes the Filter button's aria-label and breaks the queries below.
const props = {
  from: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
  to: dayjs().format('YYYY-MM-DD'),
  compare: false,
  onRangeChange: vi.fn(),
  integrations: [],
  selectedChannels: [],
  onChannelsChange: vi.fn(),
  campaigns: [],
  selectedCampaigns: [],
  onCampaignsChange: vi.fn(),
};

describe('AnalyticsFilterBar', () => {
  // Mantine throws "MantineProvider was not found in component tree" when its
  // components render outside a provider — the app tree has none, so the
  // custom-range picker carries its own. This spec deliberately does NOT mock
  // @mantine/dates (the dashboard spec does, which hid the /analytics crash).
  it('opens the custom-range DatePicker without a provider crash', () => {
    const view = render(<AnalyticsFilterBar {...props} />);

    expect(() =>
      fireEvent.click(view.getByRole('button', { name: 'Filter' }))
    ).not.toThrow();
    expect(() =>
      fireEvent.click(view.getByRole('button', { name: 'Custom' }))
    ).not.toThrow();

    // The real Mantine calendar grid actually mounted (drawer portals to body).
    expect(document.body.querySelector('table')).toBeTruthy();
  });
});
