import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback,
}));

const closeAllMock = vi.fn();
const closeCurrentMock = vi.fn();
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: vi.fn(),
    closeAll: closeAllMock,
    closeCurrent: closeCurrentMock,
  }),
}));

vi.mock('@postmill-ai/frontend/components/media-tools/audio-player', () => ({
  AudioPlayer: () => null,
}));

import { VoicePicker } from './voice-picker';
import type { HeyGenVoice } from './use-heygen';

const VOICES: HeyGenVoice[] = [
  {
    voiceId: 'hv-1',
    name: 'Aria',
    language: 'English',
    gender: 'Female',
    previewAudio: 'https://cdn.example.com/aria.mp3',
    supportPause: false,
    emotionSupport: false,
  },
  {
    voiceId: 'hv-2',
    name: 'Bjorn',
    language: 'Norwegian',
    gender: 'Male',
    previewAudio: null,
    supportPause: false,
    emotionSupport: false,
  },
];

afterEach(cleanup);

beforeEach(() => {
  closeAllMock.mockReset();
  closeCurrentMock.mockReset();
});

describe('VoicePicker', () => {
  it('selects the voice and closes only the picker modal (closeCurrent, not closeAll)', () => {
    const onSelect = vi.fn();
    render(<VoicePicker voices={VOICES} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[0]);
    expect(onSelect).toHaveBeenCalledWith(VOICES[0]);
    // Regression: closeAll() wiped a host dialog (Designer's avatar dialog)
    // along with its script/portrait state.
    expect(closeCurrentMock).toHaveBeenCalledTimes(1);
    expect(closeAllMock).not.toHaveBeenCalled();
  });

  it('filters voices by name or language', () => {
    render(<VoicePicker voices={VOICES} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search by name or language...'), {
      target: { value: 'norwegian' },
    });
    expect(screen.queryByText('Aria')).toBeNull();
    expect(screen.getByText('Bjorn')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use' })).toBeTruthy();
  });

  it('marks the selected voice and reports empty results', () => {
    render(<VoicePicker voices={VOICES} selectedId="hv-1" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Selected' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search by name or language...'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No voices match "zzz"')).toBeTruthy();
  });
});
