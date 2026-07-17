import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetchFn = vi.fn();
const mockToasterShow = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { MediaProvidersTab } from './media-providers.tab';

const providersResponse = [
  {
    identifier: 'openai',
    name: 'OpenAI',
    type: 'direct',
    capabilities: ['image', 'tts', 'stt'],
    configured: true,
    enabled: true,
  },
  {
    identifier: 'elevenlabs',
    name: 'ElevenLabs',
    type: 'direct',
    capabilities: ['tts'],
    configured: false,
    enabled: false,
  },
];

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFn.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(providersResponse),
  });
});

describe('MediaProvidersTab (F2)', () => {
  it('fetches the /settings/media endpoint, not the admin one', async () => {
    render(<MediaProvidersTab />, { wrapper });

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith('/settings/media/providers');
    });

    const requestedUrls = mockFetchFn.mock.calls.map((call) => call[0]);
    expect(requestedUrls).toContain('/settings/media/providers');
    expect(requestedUrls).toContain('/settings/media/config');
    for (const url of requestedUrls) {
      expect(url).not.toContain('/admin/ai-settings');
    }
  });

  it('renders the provider list on a successful response', async () => {
    render(<MediaProvidersTab />, { wrapper });

    // Provider names appear in the cards and again in the operations table
    // headers — assert at least one of each.
    await waitFor(() => {
      expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('ElevenLabs').length).toBeGreaterThan(0);
    expect(screen.getByText('AI Media')).toBeTruthy();
  });

  it('does not render any credential or secret fields', async () => {
    const { container } = render(<MediaProvidersTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0);
    });

    // No credential entry fields in the list view (the only inputs allowed
    // are the enable/disable toggles on the provider cards and the search box).
    expect(container.querySelectorAll('input[type="password"]').length).toBe(0);
    const nonSearchInputs = Array.from(
      container.querySelectorAll('input')
    ).filter(
      (el) =>
        el.getAttribute('type') !== 'checkbox' &&
        !(el.getAttribute('placeholder') || '').toLowerCase().includes('search')
    );
    expect(nonSearchInputs.length).toBe(0);

    // No secret-ish text leaks into the DOM.
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain('apikey');
    expect(html).not.toContain('api key');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('credential');
  });

  it('shows the empty state when no providers are returned', async () => {
    mockFetchFn.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<MediaProvidersTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('No providers configured. Use the button above to add one.')).toBeTruthy();
    });
  });

  it('shows the error state when the request fails', async () => {
    mockFetchFn.mockResolvedValue({ ok: false });
    render(<MediaProvidersTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Failed to load settings')).toBeTruthy();
    });
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
