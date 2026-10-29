import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StudioDescriptor, StudioJob } from './types';

const mockShow = vi.fn();
const mockGenerate = vi.fn();
const mockMutateJobs = vi.fn();
let jobs: StudioJob[] = [];

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(params?.[key] ?? '')),
}));

vi.mock('./hooks', () => ({
  useStudioStatus: () => ({ data: { configured: true, enabled: true } }),
  useStudioJobs: () => ({ data: jobs, isLoading: false, mutate: mockMutateJobs }),
  useStudioGenerate: () => mockGenerate,
}));

vi.mock('./studio-form', () => ({ StudioForm: () => null }));
vi.mock('./studio-landing', () => ({ StudioLanding: () => null }));
vi.mock('./render-queue', () => ({ RenderQueue: () => null }));
vi.mock('@postmill-ai/frontend/components/new-layout/logo', () => ({ Logo: () => null }));
vi.mock('@postmill-ai/frontend/components/ui/overflow-tabs', () => ({ OverflowTabs: () => null }));
vi.mock('@postmill-ai/frontend/components/media-tools/fullscreen-button', () => ({ FullscreenButton: () => null }));
vi.mock('@postmill-ai/frontend/components/media-tools/use-fullscreen', () => ({
  useFullscreenSurface: (className: string) => className,
}));

import { StudioShell } from './studio-shell';

const descriptor: StudioDescriptor = {
  provider: 'replicate',
  title: 'Replicate',
  tabs: [{ key: 'video', label: 'Video', operation: 'video', fields: [] }],
};

const job = (overrides: Partial<StudioJob> = {}): StudioJob => ({
  id: 'job-1',
  operation: 'video',
  status: 'processing',
  artifactUrl: null,
  fileId: null,
  fileType: null,
  error: null,
  createdAt: '2026-10-29T00:00:00.000Z',
  ...overrides,
});

const quotaError = JSON.stringify({
  message: "Replicate reports the account's quota or billing limit was reached: insufficient credits",
  kind: 'quota',
  settingsUrl: '/settings/content/ai-media',
});

beforeEach(() => {
  jobs = [];
  mockShow.mockReset();
  mockGenerate.mockReset();
  mockMutateJobs.mockReset();
});

afterEach(cleanup);

describe('StudioShell job failure feedback', () => {
  it('primes historical failures without toasting on mount or repeated renders', async () => {
    jobs = [job({ status: 'failed', error: quotaError })];
    const view = render(<StudioShell descriptor={descriptor} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy());
    view.rerender(<StudioShell descriptor={descriptor} />);
    view.rerender(<StudioShell descriptor={descriptor} />);
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('toasts one pending-to-failed transition with provider advice and settings, never on later polls', async () => {
    jobs = [job()];
    const view = render(<StudioShell descriptor={descriptor} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy());

    jobs = [job({ status: 'failed', error: quotaError })];
    view.rerender(<StudioShell descriptor={descriptor} />);

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
    expect(mockShow).toHaveBeenCalledWith(
      expect.stringContaining("The account's quota or billing limit was reached"),
      'warning',
      '/settings/content/ai-media',
      'Open settings',
    );
    expect(mockShow.mock.calls[0][0]).not.toContain('"kind"');

    view.rerender(<StudioShell descriptor={descriptor} />);
    view.rerender(<StudioShell descriptor={descriptor} />);
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('preserves the immediate provider 502 toast and its settings action', async () => {
    mockGenerate.mockRejectedValue(Object.assign(new Error('quota'), {
      providerError: {
        provider: 'replicate',
        providerName: 'Replicate',
        kind: 'quota',
        message: 'Replicate quota exhausted',
        settingsUrl: '/settings/content/ai-media',
      },
    }));
    render(<StudioShell descriptor={descriptor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
    expect(mockShow).toHaveBeenCalledWith(
      expect.stringContaining('Replicate quota exhausted'),
      'warning',
      '/settings/content/ai-media',
      'Open settings',
    );
  });
});
