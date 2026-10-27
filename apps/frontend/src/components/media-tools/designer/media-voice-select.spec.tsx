import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MediaVoiceSelect } from './media-voice-select';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key]))
      : fallback,
}));

const voices = Array.from({ length: 3000 }, (_, index) => ({
  id: `voice-${index}`,
  label: index === 2999 ? 'Leanne - Expressive & Earthy' : `Voice ${index}`,
}));

afterEach(cleanup);

describe('MediaVoiceSelect', () => {
  it('bounds initial rendering and finds every voice through search', () => {
    const onChange = vi.fn();
    render(
      <MediaVoiceSelect
        voices={voices}
        value=""
        onChange={onChange}
        className="voice-input"
        ariaLabel="Voice"
      />
    );

    expect(screen.getAllByRole('option')).toHaveLength(51);
    expect(screen.queryByRole('option', { name: 'Leanne - Expressive & Earthy' })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search voices' }), {
      target: { value: 'leanne' },
    });
    const match = screen.getByRole('option', { name: 'Leanne - Expressive & Earthy' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Voice' }), {
      target: { value: 'voice-2999' },
    });
    expect(onChange).toHaveBeenCalledWith('voice-2999');
    expect(match).toBeDefined();
  });

  it('keeps a selected voice available when it is outside the current page', () => {
    render(
      <MediaVoiceSelect
        voices={voices}
        value="voice-2999"
        onChange={vi.fn()}
        className="voice-input"
        ariaLabel="Voice"
      />
    );

    expect(screen.getByRole('option', { name: 'Leanne - Expressive & Earthy' })).toBeDefined();
    expect(screen.getAllByRole('option')).toHaveLength(52);
  });
});
