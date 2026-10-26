import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

// jsdom's Audio is inert but real; stub it so the spec can observe the
// preload/src the component assigns and drive playback deterministically.
class FakeAudio {
  static instances: FakeAudio[] = [];
  preload = '';
  src = '';
  paused = true;
  duration = 0;
  currentTime = 0;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }
  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
}

vi.stubGlobal('Audio', FakeAudio);

import { AudioPlayer } from './audio-player';

// Cross-origin src: the waveform decoder bails before touching AudioContext,
// which jsdom does not implement.
const SRC = 'https://cdn.example.com/preview.mp3';

afterEach(cleanup);

beforeEach(() => {
  FakeAudio.instances = [];
});

describe('AudioPlayer', () => {
  it('lazy instances set preload="none" so mounting a long list fires no metadata requests', () => {
    render(<AudioPlayer src={SRC} lazy />);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].preload).toBe('none');
    expect(FakeAudio.instances[0].src).toBe(SRC);
  });

  it('non-lazy instances keep preload="metadata" so duration shows without playing', () => {
    render(<AudioPlayer src={SRC} />);
    expect(FakeAudio.instances[0].preload).toBe('metadata');
  });

  it('lazy playback still works on first press and fills in the duration from metadata', async () => {
    render(<AudioPlayer src={SRC} lazy />);
    const audio = FakeAudio.instances[0];
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(audio.playCalls).toBe(1);
    audio.duration = 12;
    act(() => audio.emit('loadedmetadata'));
    await waitFor(() => expect(screen.getByText(/0:00 \/ 0:12/)).toBeTruthy());
  });
});
