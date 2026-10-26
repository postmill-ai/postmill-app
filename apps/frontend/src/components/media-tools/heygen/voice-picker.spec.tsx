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

const LARGE_VOICE_LIST: HeyGenVoice[] = Array.from({ length: 125 }, (_, index) => ({
  voiceId: `hv-${index + 1}`,
  name: index === 100 ? 'Hidden Voice' : `Voice ${index + 1}`,
  language: 'English',
  gender: 'Female',
  previewAudio: null,
  supportPause: false,
  emotionSupport: false,
}));

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

  it('mounts only the initial batch of a large voice list', () => {
    render(<VoicePicker voices={LARGE_VOICE_LIST} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Use' })).toHaveLength(50);
    expect(screen.getByText('Voice 50')).toBeTruthy();
    expect(screen.queryByText('Voice 51')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Show more' }).getAttribute('aria-controls')
    ).toBe('heygen-voice-list');
  });

  it('reveals the next batch when Show more is activated', () => {
    render(<VoicePicker voices={LARGE_VOICE_LIST} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getAllByRole('button', { name: 'Use' })).toHaveLength(100);
    expect(screen.getByText('Voice 100')).toBeTruthy();
    expect(screen.queryByText('Hidden Voice')).toBeNull();
  });

  it('searches the full list beyond the mounted batch', () => {
    render(<VoicePicker voices={LARGE_VOICE_LIST} onSelect={vi.fn()} />);
    expect(screen.queryByText('Hidden Voice')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search by name or language...'), {
      target: { value: 'hidden voice' },
    });
    expect(screen.getByText('Hidden Voice')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Use' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
