import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

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

import { DynamicForm } from './dynamic-form';
import { useReplicateStore } from './replicate.store';

const WHISPER_MODEL = {
  id: 'openai/whisper',
  name: 'Whisper',
  coverImageUrl: null,
  warm: true,
  versionId: 'v1',
  inputSchema: {
    required: ['audio'],
    properties: {
      audio: { type: 'string', format: 'uri', title: 'Audio' },
      language: {
        type: 'string',
        title: 'Language',
        enum: ['none', 'en', 'de', 'fr-FR', 'zh'],
      },
    },
  },
};

afterEach(cleanup);

beforeEach(() => {
  useReplicateStore.getState().reset();
  useReplicateStore.getState().setCategory('stt');
  useReplicateStore.getState().setSelectedModel(WHISPER_MODEL);
});

describe('DynamicForm language enum', () => {
  it('renders BCP-47 codes as language names, keeps the code as the value', async () => {
    render(<DynamicForm />);
    fireEvent.click(await screen.findByText('Advanced settings'));

    const select = document.querySelector('select') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    // The auto-detect sentinels get a real label, codes get their NATIVE
    // display names (same convention as the UI-language picker) — and the
    // submitted value stays the raw code.
    expect(options).toContainEqual({ value: 'none', label: 'Auto-detect' });
    expect(options).toContainEqual({ value: 'en', label: 'English' });
    expect(options).toContainEqual({ value: 'de', label: 'Deutsch' });
    expect(options).toContainEqual({ value: 'zh', label: '中文' });
    expect(options.find((o) => o.value === 'fr-FR')?.label).toMatch(/^français/);

    fireEvent.change(select, { target: { value: 'de' } });
    expect(
      (useReplicateStore.getState().formInput as Record<string, unknown>).language
    ).toBe('de');
  });

  it('leaves non-language enums untouched', async () => {
    useReplicateStore.getState().setSelectedModel({
      ...WHISPER_MODEL,
      inputSchema: {
        properties: {
          mode: { type: 'string', title: 'Mode', enum: ['std', 'pro'] },
        },
      },
    });
    render(<DynamicForm />);
    fireEvent.click(await screen.findByText('Advanced settings'));

    const select = document.querySelector('select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['Select…', 'std', 'pro']);
  });
});

describe('DynamicForm per-model hidden fields', () => {
  const VIDEO_01_MODEL = {
    id: 'minimax/video-01',
    name: 'video-01',
    coverImageUrl: null,
    warm: true,
    versionId: 'v1',
    inputSchema: {
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', title: 'Prompt' },
        first_frame_image: {
          type: 'string',
          format: 'uri',
          title: 'First Frame Image',
        },
        subject_reference: {
          type: 'string',
          format: 'uri',
          title: 'Subject Reference',
        },
      },
    },
  };

  it('hides video-01 subject_reference so an i2v upload lands on first_frame_image', async () => {
    // Prod failure (QA 2026-10-26): an uploaded image placed in
    // subject_reference silently switches video-01 to the upstream S2V-01
    // model, which failed every attempt with "Error 1000: unexpected error".
    useReplicateStore.getState().setCategory('image-to-video');
    useReplicateStore.getState().setSelectedModel(VIDEO_01_MODEL);
    render(<DynamicForm />);

    expect(await screen.findByText('First frame')).toBeTruthy();
    expect(screen.queryByText('Subject Reference')).toBeNull();
  });

  it('shows a read-only fixed duration without adding duration to form input', async () => {
    useReplicateStore.getState().setSelectedModel(VIDEO_01_MODEL);
    render(<DynamicForm />);

    const duration = (await screen.findByDisplayValue('~6 seconds (fixed)')) as HTMLInputElement;
    expect(duration.readOnly).toBe(true);
    expect(useReplicateStore.getState().formInput.duration).toBeUndefined();
  });
});

describe('DynamicForm model-aware video controls', () => {
  const model = (id: string, properties: Record<string, unknown>) => ({
    ...WHISPER_MODEL,
    id,
    name: id,
    inputSchema: { required: ['prompt'], properties },
  });

  it.each([
    ['google/veo-3.1', ['4', '6', '8'], '8'],
    ['bytedance/seedance-1-pro', ['5', '10'], '5'],
    ['kwaivgi/kling-v2.5-turbo-pro', ['5', '10'], '5'],
  ])('shows %s duration outside Advanced with model defaults', async (id, choices, value) => {
    useReplicateStore.getState().setCategory('text-to-video');
    useReplicateStore.getState().setSelectedModel(
      model(id, {
        prompt: { type: 'string', title: 'Prompt' },
        duration: { type: 'integer', title: 'Duration', minimum: 2, maximum: 12, default: 6 },
      })
    );
    render(<DynamicForm />);

    const duration = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(Array.from(duration.options).map((option) => option.value)).toEqual(choices);
    expect(duration.value).toBe(value);
    expect(screen.queryByText('Advanced settings')).toBeNull();
  });

  it('distinguishes Veo first/last frames from reference arrays and enforces reference mode', async () => {
    useReplicateStore.getState().setCategory('text-to-video');
    useReplicateStore.getState().setSelectedModel(
      model('google/veo-3.1', {
        prompt: { type: 'string', title: 'Prompt' },
        image: { type: 'string', format: 'uri' },
        last_frame: { type: 'string', format: 'uri' },
        reference_images: { type: 'array', items: { type: 'string', format: 'uri' } },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16'], default: '9:16' },
        duration: { type: 'integer', enum: [4, 6, 8], default: 8 },
      })
    );
    render(<DynamicForm />);

    expect(await screen.findByText('First frame')).toBeTruthy();
    expect(screen.getByText('Last frame (transition)')).toBeTruthy();
    expect(screen.getByText('Subject/style references (1–3)')).toBeTruthy();

    act(() => {
      useReplicateStore.getState().updateFormField('reference_images', [
        { fileId: 'f1', url: '/one.png', type: 'image' },
      ]);
    });
    await waitFor(() => {
      expect(useReplicateStore.getState().formInput.aspect_ratio).toBe('16:9');
      expect(useReplicateStore.getState().formInput.duration).toBe(8);
    });
  });

  it.each([
    ['bytedance/seedance-1-pro', 'image', 'last_frame_image'],
    ['kwaivgi/kling-v2.5-turbo-pro', 'start_image', 'end_image'],
  ])('labels %s first and last frames as a transition', async (id, first, last) => {
    useReplicateStore.getState().setSelectedModel(
      model(id, {
        prompt: { type: 'string', title: 'Prompt' },
        [first]: { type: 'string', format: 'uri' },
        [last]: { type: 'string', format: 'uri' },
      })
    );
    render(<DynamicForm />);

    expect(await screen.findByText('First frame')).toBeTruthy();
    expect(screen.getByText('Last frame (transition)')).toBeTruthy();
  });
});
