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

import { CompactReplicate } from './compact-replicate';
import { useReplicateStore } from './replicate.store';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const notOk = (body: unknown) => ({ ok: false, json: async () => body }) as Response;

const CATEGORIES = [
  { key: 'text-to-image', medium: 'image', label: 'Text to Image', execution: 'sync' },
  { key: 'text-to-video', medium: 'video', label: 'Text to Video', execution: 'async' },
  { key: 'meme', medium: 'image', label: 'Meme', execution: 'local' },
];

const MODELS = [
  {
    id: 'acme/sdxl',
    name: 'SDXL',
    description: '',
    coverImageUrl: null,
    runCount: 5,
    warm: true,
    pricing: 'output',
    price: { kind: 'per', usd: 0.01 },
  },
];

const MODEL_DETAIL = {
  id: 'acme/sdxl',
  name: 'SDXL',
  coverImageUrl: null,
  warm: true,
  versionId: 'v1',
  inputSchema: {
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', title: 'Prompt' },
      seed: { type: 'integer', title: 'Seed' },
    },
  },
};

// Per-test override for the model detail (prompt_a/prompt_b schemas etc.).
let modelDetail: typeof MODEL_DETAIL = MODEL_DETAIL;
// Per-test override for the async job poll payload.
let jobPayload: unknown = {
  status: 'completed',
  result: { kind: 'video', urls: ['/uploads/vid.mp4'] },
  error: null,
};

const wrap = (ui: React.ReactElement) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  );

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

const pickModel = async (categoryKey: string) => {
  fireEvent.change(await screen.findByLabelText('Category'), {
    target: { value: categoryKey },
  });
  const modelSelect = (await screen.findByLabelText('Model')) as HTMLSelectElement;
  fireEvent.change(modelSelect, { target: { value: 'acme/sdxl' } });
  // Wait for the model detail to load and the DynamicForm to render (the seed
  // field is Advanced, so the section header is the visible marker).
  await screen.findByText('Advanced settings');
};

beforeEach(() => {
  useReplicateStore.getState().reset();
  modelDetail = MODEL_DETAIL;
  jobPayload = { status: 'completed', result: { kind: 'video', urls: ['/uploads/vid.mp4'] }, error: null };
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/media/replicate/status')) return Promise.resolve(ok({ configured: true }));
    if (url.includes('/media/replicate/categories/')) return Promise.resolve(ok(MODELS));
    if (url.includes('/media/replicate/categories')) return Promise.resolve(ok(CATEGORIES));
    if (url.includes('/media/replicate/models/')) return Promise.resolve(ok(modelDetail));
    if (url.includes('/media/replicate/run/sync')) {
      return Promise.resolve(ok({ status: 'succeeded', kind: 'image', urls: ['https://cdn.replicate/out.png'] }));
    }
    if (url.includes('/media/replicate/run/async')) return Promise.resolve(ok({ jobId: 'j1' }));
    if (url.includes('/media/replicate/jobs/')) {
      return Promise.resolve(ok(jobPayload));
    }
    if (url.includes('/media/replicate/save-url')) {
      return Promise.resolve(ok({ id: 'file-1', path: '/uploads/out.png' }));
    }
    return Promise.resolve(ok({}));
  });
});

afterEach(() => {
  cleanup();
  useReplicateStore.getState().reset();
});

describe('CompactReplicate', () => {
  it('lists only categories for the dialog medium, skipping local tools', async () => {
    wrap(<CompactReplicate operation="image" prompt="a cat" onGenerated={vi.fn()} />);
    const select = (await screen.findByLabelText('Category')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('Text to Image');
    expect(labels).not.toContain('Text to Video');
    expect(labels).not.toContain('Meme');
  });

  it('hides the schema prompt field (the dialog owns it) and auto-saves sync results', async () => {
    const onGenerated = vi.fn();
    wrap(<CompactReplicate operation="image" prompt="a cat" onGenerated={onGenerated} />);
    await pickModel('text-to-image');

    // DynamicForm renders Advanced fields, but the prompt textarea is hidden.
    expect(screen.queryByText('Prompt')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(callsTo('/media/replicate/run/sync')).toHaveLength(1));
    const [, init] = callsTo('/media/replicate/run/sync')[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.modelId).toBe('acme/sdxl');
    expect(body.operation).toBe('image');
    expect(body.input.prompt).toBe('a cat');

    // Sync results are transient provider URLs — persisted via save-url first.
    await waitFor(() => expect(callsTo('/media/replicate/save-url')).toHaveLength(1));
    const [, saveInit] = callsTo('/media/replicate/save-url')[0];
    expect(JSON.parse((saveInit as RequestInit).body as string).url).toBe(
      'https://cdn.replicate/out.png'
    );
    await waitFor(() =>
      expect(onGenerated).toHaveBeenCalledWith({
        operation: 'image',
        artifactUrl: '/uploads/out.png',
        fileId: 'file-1',
      })
    );
  });

  it('polls async jobs to completion and hands back the artifact', async () => {
    const onGenerated = vi.fn();
    wrap(<CompactReplicate operation="video" prompt="a rocket" onGenerated={onGenerated} />);
    await pickModel('text-to-video');

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(callsTo('/media/replicate/run/async')).toHaveLength(1));
    const [, init] = callsTo('/media/replicate/run/async')[0];
    expect(JSON.parse((init as RequestInit).body as string).operation).toBe('video');

    // Async results already land in Files — no save-url round-trip.
    await waitFor(() =>
      expect(onGenerated).toHaveBeenCalledWith({
        operation: 'video',
        artifactUrl: '/uploads/vid.mp4',
        fileId: '',
      })
    );
    expect(callsTo('/media/replicate/save-url')).toHaveLength(0);
  });

  it('surfaces the real server error when the run fails', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/media/replicate/run/sync')) {
        return Promise.resolve(notOk({ error: 'Replicate rate limited' }));
      }
      if (url.includes('/media/replicate/status')) return Promise.resolve(ok({ configured: true }));
      if (url.includes('/media/replicate/categories/')) return Promise.resolve(ok(MODELS));
      if (url.includes('/media/replicate/categories')) return Promise.resolve(ok(CATEGORIES));
      if (url.includes('/media/replicate/models/')) return Promise.resolve(ok(MODEL_DETAIL));
      return Promise.resolve(ok({}));
    });
    const onGenerated = vi.fn();
    const onError = vi.fn();
    wrap(
      <CompactReplicate operation="image" prompt="a cat" onGenerated={onGenerated} onError={onError} />
    );
    await pickModel('text-to-image');
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Replicate rate limited'));
    expect(onError).toHaveBeenCalledWith('Replicate rate limited');
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('surfaces the real job error when an async run fails', async () => {
    jobPayload = { status: 'failed', result: null, error: 'NSFW content detected' };
    const onGenerated = vi.fn();
    const onError = vi.fn();
    wrap(
      <CompactReplicate operation="video" prompt="a rocket" onGenerated={onGenerated} onError={onError} />
    );
    await pickModel('text-to-video');
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('NSFW content detected')
    );
    expect(onError).toHaveBeenCalledWith('NSFW content detected');
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('injects the dialog prompt into prompt_a (not prompt_b, not schema defaults) for suffixed schemas', async () => {
    // riffusion-style schema: the prompt is split across prompt_a / prompt_b,
    // both carrying defaults that must not shadow the dialog prompt.
    modelDetail = {
      ...MODEL_DETAIL,
      inputSchema: {
        required: ['prompt_a'],
        properties: {
          prompt_a: { type: 'string', title: 'Prompt A', default: 'funky synth solo' },
          prompt_b: { type: 'string', title: 'Prompt B', default: 'mellow outro' },
          seed: { type: 'integer', title: 'Seed' },
        },
      },
    };
    wrap(<CompactReplicate operation="image" prompt="a cat" onGenerated={vi.fn()} />);
    await pickModel('text-to-image');

    // All prompt-role fields are hidden — they're driven by the dialog.
    expect(screen.queryByText('Prompt A')).toBeNull();
    expect(screen.queryByText('Prompt B')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(callsTo('/media/replicate/run/sync')).toHaveLength(1));
    const [, init] = callsTo('/media/replicate/run/sync')[0];
    const body = JSON.parse((init as RequestInit).body as string);
    // First prompt-role field in primary order gets the dialog prompt…
    expect(body.input.prompt_a).toBe('a cat');
    // …the rest keep their schema defaults.
    expect(body.input.prompt_b).toBe('mellow outro');
  });

  it('notes when the model has no prompt field at all', async () => {
    modelDetail = {
      ...MODEL_DETAIL,
      inputSchema: {
        properties: {
          seed: { type: 'integer', title: 'Seed' },
        },
      },
    };
    wrap(<CompactReplicate operation="image" prompt="a cat" onGenerated={vi.fn()} />);
    await pickModel('text-to-image');
    expect(
      await screen.findByText('This model has no prompt field — the dialog prompt is ignored.')
    ).toBeTruthy();
  });
});
