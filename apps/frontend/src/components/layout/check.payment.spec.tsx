import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

const mockFetch = vi.fn();
const mockModalOpen = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
vi.mock('@postmill-ai/helpers/utils/timer', () => ({ timer: () => Promise.resolve() }));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: vi.fn() }) }));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: mockModalOpen }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  default: () => <div data-testid="spinner" />,
}));

import { CheckPayment } from './check.payment';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CheckPayment', () => {
  it('renders children untouched without a check id', () => {
    render(
      <CheckPayment check="" mutate={vi.fn()}>
        <div>child</div>
      </CheckPayment>,
    );
    expect(screen.getByText('child')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('polls /billing/check/:id with the provider ref until the subscription lands, then refreshes', async () => {
    // StrictMode double-mounts the effect, so answer by call order rather than a fixed queue.
    let calls = 0;
    mockFetch.mockImplementation(async () => ({ json: async () => ({ status: calls++ === 0 ? 0 : 2 }) }));
    const mutate = vi.fn();
    render(
      <CheckPayment check="uid-1" providerRef="I-ABC" mutate={mutate}>
        <div>child</div>
      </CheckPayment>,
    );
    expect(screen.getByTestId('spinner')).toBeTruthy();
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith('/billing/check/uid-1?ref=I-ABC');
    expect(mockFetch.mock.calls.every(([url]) => url === '/billing/check/uid-1?ref=I-ABC')).toBe(true);
    await waitFor(() => expect(screen.getByText('child')).toBeTruthy());
  });

  it('gives up with a "still processing" notice when the fetch fails or the poll cap is hit', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    render(
      <CheckPayment check="uid-3" mutate={vi.fn()}>
        <div>child</div>
      </CheckPayment>,
    );
    await waitFor(() => expect(mockModalOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payment still processing' })));
    await waitFor(() => expect(screen.getByText('child')).toBeTruthy());
  });

  it('omits the ref when the provider did not supply one and reports an abandoned checkout', async () => {
    mockFetch.mockImplementation(async () => ({ json: async () => ({ status: 1 }) }));
    render(
      <CheckPayment check="uid-2" mutate={vi.fn()}>
        <div>child</div>
      </CheckPayment>,
    );
    await waitFor(() => expect(mockModalOpen).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith('/billing/check/uid-2');
    expect(mockModalOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Invalid Payment' }));
  });
});
