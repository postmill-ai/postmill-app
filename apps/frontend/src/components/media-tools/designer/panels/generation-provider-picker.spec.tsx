import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback,
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import {
  GenerationProviderPicker,
  useGenerationProviderChoice,
} from './generation-provider-picker';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const payload = (over: Record<string, unknown> = {}) => ({
  providers: [
    { identifier: 'google', name: 'Google AI Studio' },
    { identifier: 'no-compact-studio', name: 'Ghost Provider' },
  ],
  default: { providerId: 'google-ai', model: 'imagen-3' },
  ...over,
});

const renderPicker = (ui: React.ReactElement) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  );

function Harness({ dialogKey }: { dialogKey: string }) {
  const [value, setValue] = useGenerationProviderChoice(dialogKey);
  return (
    <GenerationProviderPicker
      operation="image"
      dialogKey={dialogKey}
      value={value}
      onChange={setValue}
    />
  );
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockImplementation((url: string) => Promise.resolve(ok(payload())));
});

afterEach(cleanup);

describe('GenerationProviderPicker', () => {
  it('renders the exact Default (providerId/model) label', async () => {
    renderPicker(<Harness dialogKey="image" />);
    expect(await screen.findByText('Default (google-ai/imagen-3)')).toBeTruthy();
  });

  it('renders a bare Default label when the org has no default', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok(payload({ default: null }))));
    renderPicker(<Harness dialogKey="image" />);
    expect(await screen.findByText('Default')).toBeTruthy();
    expect(screen.queryByText(/Default \(/)).toBeNull();
  });

  it('lists only providers with a registered compact studio', async () => {
    renderPicker(<Harness dialogKey="image" />);
    expect(await screen.findByText('Google AI Studio')).toBeTruthy();
    expect(screen.queryByText('Ghost Provider')).toBeNull();
  });

  it('persists the selection to sessionStorage keyed per dialog', async () => {
    renderPicker(<Harness dialogKey="image" />);
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'google' } });
    expect(sessionStorage.getItem('designer:gen-provider:image')).toBe('google');
    expect(sessionStorage.getItem('designer:gen-provider:video')).toBeNull();
  });

  it('restores the remembered choice on a fresh mount', async () => {
    sessionStorage.setItem('designer:gen-provider:image', 'google');
    renderPicker(<Harness dialogKey="image" />);
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('google'));
  });

  it('hides entirely when no listed provider has a compact studio', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(ok(payload({ providers: [{ identifier: 'no-compact-studio', name: 'Ghost' }] })))
    );
    renderPicker(<Harness dialogKey="image" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let SWR resolve, then confirm the row never appeared.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText('Provider:')).toBeNull();
  });
});
