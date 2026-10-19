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

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { CompactStudio } from './compact-studio';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

let jobsPayload: unknown[] = [];

const renderStudio = (ui: React.ReactElement) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  );

beforeEach(() => {
  jobsPayload = [];
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/status')) return Promise.resolve(ok({ configured: true, enabled: true }));
    if (url.includes('/models')) return Promise.resolve(ok([]));
    if (url.includes('/generate')) return Promise.resolve(ok({ jobId: 'job-1' }));
    if (url.includes('/jobs')) return Promise.resolve(ok(jobsPayload));
    return Promise.resolve(ok({}));
  });
});

afterEach(cleanup);

const generateCall = () =>
  fetchMock.mock.calls.find(([url]) => String(url).includes('/generate'));

describe('CompactStudio (descriptor provider)', () => {
  it('renders fields for the matching operation only', async () => {
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={vi.fn()} />
    );
    // Image tab fields…
    expect(await screen.findByText('Number of images (Imagen only)')).toBeTruthy();
    // …and nothing from the video tab.
    expect(screen.queryByText('Resolution')).toBeNull();
    expect(screen.queryByText('Duration (seconds)')).toBeNull();
  });

  it('does not render its own prompt textarea (the dialog owns the prompt)', async () => {
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={vi.fn()} />
    );
    await screen.findByText('Number of images (Imagen only)');
    expect(screen.queryByPlaceholderText('Describe the image…')).toBeNull();
  });

  it('injects the prompt prop into the submitted input', async () => {
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={vi.fn()} />
    );
    const button = await screen.findByRole('button', { name: 'Generate' });
    fireEvent.click(button);
    await waitFor(() => expect(generateCall()).toBeTruthy());
    const [url, init] = generateCall()!;
    expect(String(url)).toBe('/media/studio/google/generate');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.operation).toBe('image');
    expect(body.model).toBe('gemini-2.5-flash-image');
    expect(body.input.prompt).toBe('a cat');
    expect(body.input.aspectRatio).toBe('1:1');
  });

  it('calls onGenerated when the tracked job completes', async () => {
    jobsPayload = [
      {
        id: 'job-1',
        operation: 'image',
        status: 'completed',
        artifactUrl: '/uploads/cat.png',
        fileId: 'file-9',
        error: null,
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    const onGenerated = vi.fn();
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={onGenerated} />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
    expect(onGenerated).toHaveBeenCalledWith({
      operation: 'image',
      artifactUrl: '/uploads/cat.png',
      fileId: 'file-9',
    });
  });

  it('surfaces the job error when generation fails', async () => {
    jobsPayload = [
      {
        id: 'job-1',
        operation: 'image',
        status: 'failed',
        artifactUrl: null,
        fileId: null,
        error: 'Imagen quota exceeded',
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    const onGenerated = vi.fn();
    const onError = vi.fn();
    renderStudio(
      <CompactStudio
        provider="google"
        operation="image"
        prompt="a cat"
        onGenerated={onGenerated}
        onError={onError}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Imagen quota exceeded');
    expect(onError).toHaveBeenCalledWith('Imagen quota exceeded');
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('shows a configure note instead of the form when the provider is not configured', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/status')) return Promise.resolve(ok({ configured: false, enabled: false }));
      return Promise.resolve(ok({}));
    });
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={vi.fn()} />
    );
    expect(
      await screen.findByText(/isn't configured — add your credentials/)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
  });
});
