import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

const mockFetch = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

// Translate with {{param}} interpolation so rendered error text is assertable.
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, params?: Record<string, string>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_m, name) => params?.[name] ?? ''),
}));

vi.mock('@postmill-ai/frontend/components/campaigns/selector/campaign-selector', () => ({
  CampaignSelector: () => null,
}));

import { ProviderFormModal } from './provider-form.modal';

describe('ProviderFormModal — required config fields (CLOUDFLARE_R2, POSTMILL-APP-W)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fill = (placeholder: string, value: string) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value },
    });

  it('blocks save and names the missing fields instead of POSTing', async () => {
    render(
      <ProviderFormModal onClose={() => {}} onSaved={() => {}} presetType="CLOUDFLARE_R2" />
    );

    fill('My Storage', 'My R2');
    fireEvent.click(screen.getByText('Add Provider'));

    expect(
      await screen.findByText(/Missing required fields: Bucket, Endpoint/)
    ).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('saves once bucket and endpoint are filled', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const onSaved = vi.fn();
    render(
      <ProviderFormModal onClose={() => {}} onSaved={onSaved} presetType="CLOUDFLARE_R2" />
    );

    fill('My Storage', 'My R2');
    fill('my-bucket', 'media');
    fill('https://<accountId>.r2.cloudflarestorage.com', 'https://acct.r2.cloudflarestorage.com');
    fill('AKIA...', 'AKIAEXAMPLE');
    fill('••••••••', 'secret');
    fireEvent.click(screen.getByText('Add Provider'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('/settings/storage');
    const body = JSON.parse(init.body);
    expect(body.type).toBe('CLOUDFLARE_R2');
    expect(body.bucket).toBe('media');
    expect(body.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
  });

  it('shows Configured + last-updated when editing an existing provider', () => {
    render(
      <ProviderFormModal
        onClose={() => {}}
        onSaved={() => {}}
        editProvider={{
          id: 'sp-1',
          type: 'CLOUDFLARE_R2',
          name: 'My R2',
          updatedAt: '2026-10-22T21:41:25.512Z',
        }}
      />
    );
    expect(screen.getByText(/^Configured$/)).toBeTruthy();
    expect(screen.getByText(/Last updated/)).toBeTruthy();
  });

  it('hides the Configured status for a new provider', () => {
    render(
      <ProviderFormModal onClose={() => {}} onSaved={() => {}} presetType="CLOUDFLARE_R2" />
    );
    expect(screen.queryByText(/^Configured$/)).toBeNull();
    expect(screen.queryByText(/Last updated/)).toBeNull();
  });
});
