import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

const mockShow = vi.fn();
const mockDeleteDialog = vi.fn();

// afterRequest is handed to FetchWrapperComponent; capture it so the tests can drive it
// with synthetic responses instead of standing up a real fetch.
let capturedAfterRequest: (
  url: string,
  options: RequestInit,
  response: any
) => Promise<boolean>;

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  FetchWrapperComponent: ({ children, afterRequest }: any) => {
    capturedAfterRequest = afterRequest;
    return <>{children}</>;
  },
}));

vi.mock('@postmill-ai/react/helpers/delete.dialog', () => ({
  deleteDialog: (...args: any[]) => mockDeleteDialog(...args),
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

vi.mock('@postmill-ai/frontend/app/(app)/auth/return.url.component', () => ({
  useReturnUrl: () => ({ getAndClear: () => null }),
}));

vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({
    backendUrl: 'http://localhost:3000/api',
    isGeneral: true,
    isSecured: true,
  }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback?: string, opts?: Record<string, any>) => {
      const text = fallback ?? _key;
      if (!opts) return text;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        text
      );
    },
}));

import LayoutContext from './layout.context';

const makeResponse = (status: number, headers: Record<string, string> = {}) => ({
  status,
  headers: {
    get: (key: string) => headers[key.toLowerCase()] ?? null,
  },
  json: () => Promise.resolve({}),
});

// The 429 toast is windowed at module scope, so each test drives Date.now() forward past
// the window rather than fighting leftover state from the previous one.
let now = 1_000_000;

describe('LayoutContext afterRequest 429 handling (C4)', () => {
  beforeEach(() => {
    mockShow.mockClear();
    mockDeleteDialog.mockClear();
    now += 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    render(
      <LayoutContext>
        <div>child</div>
      </LayoutContext>
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a warning toast and does not navigate', async () => {
    const before = window.location.href;

    const result = await capturedAfterRequest('/user/self', {}, makeResponse(429));

    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0][0]).toContain('Too many requests');
    expect(mockShow.mock.calls[0][1]).toBe('warning');
    // Never eject the user off the page they're on because a background poll was throttled.
    expect(window.location.href).toBe(before);
    // `true` lets the caller see the response, so SWR can error and back off.
    expect(result).toBe(true);
  });

  it('echoes Retry-After when the throttler sends one', async () => {
    await capturedAfterRequest(
      '/user/self',
      {},
      makeResponse(429, { 'retry-after': '42' })
    );

    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0][0]).toBe(
      'Too many requests. Please try again in 42 seconds.'
    );
  });

  it('does not stack a toast per 429 in a burst', async () => {
    for (let i = 0; i < 20; i++) {
      await capturedAfterRequest('/dashboard/media-jobs', {}, makeResponse(429));
      now += 100;
    }

    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('toasts again once the dedupe window has elapsed', async () => {
    await capturedAfterRequest('/user/self', {}, makeResponse(429));
    now += 16_000;
    await capturedAfterRequest('/user/self', {}, makeResponse(429));

    expect(mockShow).toHaveBeenCalledTimes(2);
  });

  it('leaves non-429 responses alone', async () => {
    const result = await capturedAfterRequest('/user/self', {}, makeResponse(200));

    expect(mockShow).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
