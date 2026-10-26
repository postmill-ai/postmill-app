import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

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

    expect(await screen.findByText('First Frame Image')).toBeTruthy();
    expect(screen.queryByText('Subject Reference')).toBeNull();
  });
});
