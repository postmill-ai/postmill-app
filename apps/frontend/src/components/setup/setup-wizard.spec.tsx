import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);
const mockReplace = vi.fn();
const mockMutate = vi.fn();
const mockFetch = vi.fn();

let summaryData: any = { aiProviderActive: false };

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('swr', () => ({
  default: (key: string, _fetcher: any, opts?: any) => {
    if (key === '/dashboard/summary') {
      return { data: summaryData, mutate: vi.fn() };
    }
    return { data: null, mutate: vi.fn() };
  },
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('./steps/step-llm', () => ({ StepLlm: () => <div data-testid="step-llm" /> }));
vi.mock('./steps/step-ai-media', () => ({ StepAiMedia: () => <div data-testid="step-ai-media" /> }));
vi.mock('./steps/step-channels', () => ({ StepChannels: () => <div data-testid="step-channels" /> }));
vi.mock('./steps/step-content-packs', () => ({ StepContentPacks: () => <div data-testid="step-content-packs" /> }));
vi.mock('./steps/step-storage', () => ({ StepStorage: () => <div data-testid="step-storage" /> }));
vi.mock('./steps/step-shortlinks', () => ({ StepShortlinks: () => <div data-testid="step-shortlinks" /> }));
vi.mock('./steps/step-vpn', () => ({ StepVpn: () => <div data-testid="step-vpn" /> }));

vi.mock('./setup-stepper', () => ({
  SetupStepper: ({ currentStep }: any) => <div data-testid={`stepper-${currentStep}`} />,
}));

import { SetupWizard } from './setup-wizard';

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryData = { aiProviderActive: false };
    window.sessionStorage.clear();
  });

  it('disables Next on step 1 when no LLM is active', () => {
    render(<SetupWizard />);
    const next = screen.getByRole('button', { name: /next/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('enables Next on step 1 when an LLM is active', () => {
    summaryData = { aiProviderActive: true };
    render(<SetupWizard />);
    const next = screen.getByRole('button', { name: /next/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
  });

  it('advances to the next step when Next is clicked', () => {
    summaryData = { aiProviderActive: true };
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('stepper-1')).toBeDefined();
  });

  it('restores the active step from sessionStorage after an OAuth round-trip', () => {
    summaryData = { aiProviderActive: true };
    window.sessionStorage.setItem('setup:step', '2'); // e.g. left off on the Channels step
    render(<SetupWizard />);
    expect(screen.getByTestId('stepper-2')).toBeDefined();
  });

  it('persists the active step to sessionStorage when advancing', () => {
    summaryData = { aiProviderActive: true };
    render(<SetupWizard />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(window.sessionStorage.getItem('setup:step')).toBe('1');
  });

  it('Finish calls complete endpoint, mutates /user/self, then navigates to /dashboard', async () => {
    summaryData = { aiProviderActive: true };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ setupCompleted: true }) });

    render(<SetupWizard />);
    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/settings/setup/complete', { method: 'POST' });
    });
    expect(mockMutate).toHaveBeenCalledWith(
      '/user/self',
      expect.any(Function),
      { revalidate: true }
    );
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });
});
