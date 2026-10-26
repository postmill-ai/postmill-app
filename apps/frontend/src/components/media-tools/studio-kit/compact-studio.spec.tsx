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

  it('adopts a still-running job on mount (refresh mid-render re-attaches)', async () => {
    jobsPayload = [
      {
        id: 'job-in-flight',
        operation: 'image',
        status: 'processing',
        artifactUrl: null,
        fileId: null,
        error: null,
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    const onGenerated = vi.fn();
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={onGenerated} />
    );
    // No Generate click — the mount-time adoption picks up the in-flight job
    // and shows the progress note.
    expect(await screen.findByText(/Rendering — this can take a few minutes/)).toBeTruthy();

    // The job then completes: the adopted poll loop hands the artifact back.
    jobsPayload = [
      {
        id: 'job-in-flight',
        operation: 'image',
        status: 'completed',
        artifactUrl: '/uploads/cat.png',
        fileId: 'file-9',
        error: null,
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    // SWR dedupes identical keys within the interval — force a revalidation so
    // the refreshed payload is seen (refreshInterval only fires live timers).
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1), { timeout: 12000 });
    expect(onGenerated).toHaveBeenCalledWith({
      operation: 'image',
      artifactUrl: '/uploads/cat.png',
      fileId: 'file-9',
    });
  }, 15000);

  it('unwraps the structured failure envelope and links Settings', async () => {
    jobsPayload = [
      {
        id: 'job-1',
        operation: 'image',
        status: 'failed',
        artifactUrl: null,
        fileId: null,
        error: JSON.stringify({
          message: "Google AI Studio reports the account's quota or billing limit was reached (HTTP 429): quota exceeded",
          kind: 'quota',
          settingsUrl: '/settings/content/ai-media',
        }),
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    const onGenerated = vi.fn();
    renderStudio(
      <CompactStudio provider="google" operation="image" prompt="a cat" onGenerated={onGenerated} />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('quota or billing limit');
    expect(alert.textContent).not.toContain('"kind"');
    const link = alert.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/settings/content/ai-media');
    expect(onGenerated).not.toHaveBeenCalled();
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

  // Regression: the Designer dialogs key CompactStudio by provider so switching
  // providers remounts the studio. Without the remount, valuesByTab survives
  // across providers that share a tab key (both ElevenLabs and fal/Kling use
  // 'text-to-video') and the stale model id is submitted to the new provider
  // (production: model 'veo-3.1-generate-001' sent to fal → upstream 404).
  it('resets the model selection when the provider is switched (keyed remount)', async () => {
    const Harness = () => {
      const [provider, setProvider] = React.useState('elevenlabs');
      return (
        <>
          <button onClick={() => setProvider('fal')}>switch provider</button>
          <CompactStudio
            key={provider}
            provider={provider}
            operation="video"
            prompt="a rocket"
            onGenerated={vi.fn()}
          />
        </>
      );
    };
    renderStudio(<Harness />);

    // Pick the non-default Veo model on ElevenLabs.
    const elevenLabsModel = await screen.findByLabelText('Model');
    fireEvent.change(elevenLabsModel, { target: { value: 'veo-3.1-generate-001' } });
    expect((elevenLabsModel as HTMLSelectElement).value).toBe('veo-3.1-generate-001');

    // Switch to fal — the remount must drop the ElevenLabs values entirely.
    fireEvent.click(screen.getByText('switch provider'));
    const falModel = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    expect(falModel.value).toBe('fal-ai/kling-video/v1.6/standard/text-to-video');

    // And the submitted body carries fal's model, never the stale ElevenLabs id.
    // (fetchMock calls accumulate across tests — match the fal call specifically.)
    const falGenerateCall = () =>
      fetchMock.mock.calls.find(([url]) => String(url).includes('/media/studio/fal/generate'));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(falGenerateCall()).toBeTruthy());
    const [, init] = falGenerateCall()!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('fal-ai/kling-video/v1.6/standard/text-to-video');
  });
});
