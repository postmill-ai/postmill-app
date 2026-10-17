import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';

const mockFetch = vi.fn();
const mockToasterShow = vi.fn();
const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: vi.fn(async () => true) }),
}));

vi.mock('swr', () => ({
  default: () => ({ data: undefined, mutate: vi.fn() }),
}));

import { useProviderSurface } from './use-provider-surface';

const descriptor: any = {
  key: 'ai',
  basePath: '/settings/ai',
  swrKey: 'org-ai-config',
  load: vi.fn(),
  features: { test: true },
  form: {},
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('useProviderSurface.test', () => {
  beforeEach(() => vi.clearAllMocks());

  const run = () => renderHook(() => useProviderSurface(descriptor)).result.current;

  it('threads the adapter error from a 200 { ok: false, error } body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: false, error: 'Invalid API key' }));
    const result = await run().test('openai', {});
    expect(result).toEqual({ ok: false, error: 'Invalid API key' });
    expect(mockToasterShow).toHaveBeenCalledWith('Invalid API key', 'warning');
  });

  it('threads the NestJS message from a non-2xx JSON body', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(400, { message: 'Unknown provider', statusCode: 400 }),
    );
    const result = await run().test('openai', {});
    expect(result).toEqual({ ok: false, error: 'Unknown provider' });
  });

  it('reports success on a 200 { ok: true } body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));
    const result = await run().test('openai', {});
    expect(result).toEqual({ ok: true, error: undefined });
  });

  it('falls back to the generic message on a network failure', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const result = await run().test('openai', {});
    expect(result).toEqual({ ok: false });
    expect(mockToasterShow).toHaveBeenCalledWith('Connection failed', 'warning');
  });
});
