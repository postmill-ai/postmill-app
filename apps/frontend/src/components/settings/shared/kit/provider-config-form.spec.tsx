import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockT = vi.fn((key: string, fallback?: string, opts?: Record<string, string>) => {
  let out = fallback ?? key;
  for (const [k, v] of Object.entries(opts ?? {})) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  return out;
});

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock(
  '@postmill-ai/frontend/components/settings/shared/provider-version-select',
  () => ({
    ProviderVersionSelect: () => null,
    useProviderVersionSelection: () => ({
      versions: [],
      selected: 'v1',
      selectVersion: vi.fn(),
      showSelect: false,
      credentialFields: undefined,
    }),
  }),
);

vi.mock('./fields', () => ({ ExtraField: () => null }));

import { ProviderConfigForm } from './provider-config-form';

const descriptor: any = {
  key: 'ai',
  basePath: '/settings/ai',
  catalogDomain: 'ai',
  features: { toggle: true, primary: true, remove: true, test: true, testOnSave: true },
  form: {
    credentialFieldsFromMeta: () => [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
    ],
    buildBody: (state: any) => ({ credentials: state.credentials }),
    buildTestBody: (state: any) => ({ credentials: state.credentials }),
  },
};

function renderForm(over: Partial<Parameters<typeof ProviderConfigForm>[0]> = {}) {
  const props = {
    descriptor,
    identifier: 'openai',
    isConfigured: false,
    meta: {},
    website: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs',
    keysUrl: 'https://platform.openai.com/api-keys',
    onClose: vi.fn(),
    onSaved: vi.fn(),
    save: vi.fn(async () => true),
    test: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => true),
    ...over,
  } as any;
  render(<ProviderConfigForm {...props} />);
  return props;
}

describe('ProviderConfigForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links "Where do I get my API key?" to the manifest keysUrl', () => {
    renderForm();
    const link = screen.getByText(/where do i get my api key/i).closest('a')!;
    expect(link.href).toBe('https://platform.openai.com/api-keys');
  });

  it('renders a Docs link next to the keys link when docsUrl is present', () => {
    renderForm();
    const docs = screen.getByText(/^docs/i).closest('a')!;
    expect(docs.href).toBe('https://platform.openai.com/docs');
  });

  it('falls back to docsUrl, then website, for the get-your-key link', () => {
    render(
      <ProviderConfigForm
        {...({
          descriptor,
          identifier: 'openai',
          isConfigured: false,
          meta: {},
          website: 'https://openai.com',
          docsUrl: 'https://platform.openai.com/docs',
          onClose: vi.fn(),
          onSaved: vi.fn(),
          save: vi.fn(),
          test: vi.fn(),
          remove: vi.fn(),
        } as any)}
      />,
    );
    expect(
      screen.getByText(/where do i get my api key/i).closest('a')!.href,
    ).toBe('https://platform.openai.com/docs');
  });

  it('auto-tests on save and blocks the save with the adapter error on failure', async () => {
    const props = renderForm({
      test: vi.fn(async () => ({ ok: false, error: 'Invalid API key' })),
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid api key/i)).toBeDefined();
    });
    expect(props.test).toHaveBeenCalledTimes(1);
    expect(props.save).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('"Save anyway" escapes the failed auto-test and saves', async () => {
    const props = renderForm({
      test: vi.fn(async () => ({ ok: false, error: 'Invalid API key' })),
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const escape = await screen.findByRole('button', { name: /save anyway/i });
    fireEvent.click(escape);
    await waitFor(() => {
      expect(props.save).toHaveBeenCalledTimes(1);
      expect(props.onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('saves directly when the auto-test passes', async () => {
    const props = renderForm();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(props.save).toHaveBeenCalledTimes(1);
      expect(props.onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('warns when the pasted key does not match the placeholder prefix', async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'not-a-real-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/usually starts with "sk-"/i)).toBeDefined();
    });
  });

  it('surfaces the adapter error inline on a failed manual test', async () => {
    renderForm({
      test: vi.fn(async () => ({ ok: false, error: 'Invalid API key' })),
    });
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid api key/i)).toBeDefined();
    });
  });
});
