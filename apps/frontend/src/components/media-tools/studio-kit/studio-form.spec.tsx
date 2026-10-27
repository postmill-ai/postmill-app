import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudioForm } from './studio-form';
import { studioSelectOptions, type StudioField } from './types';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback: string) =>
    ({
      kling_ai_text_to_video_resolution_opt0: 'Translated 720p',
      kling_ai_text_to_video_resolution_opt1: 'Translated 1080p',
    })[key] ?? fallback,
}));

const fields: StudioField[] = [
  {
    type: 'select',
    name: 'model',
    label: 'Model',
    options: [{ value: 'kling-2.6', label: 'Kling 2.6' }],
  },
  {
    type: 'select',
    name: 'audio',
    label: 'Audio',
    options: [
      { value: 'off', label: 'Silent' },
      { value: 'native', label: 'Native audio' },
    ],
  },
  {
    type: 'select',
    name: 'resolution',
    label: 'Resolution',
    default: '720p',
    options: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' },
    ],
    optionRules: [
      {
        when: { model: 'kling-2.6', audio: 'native' },
        options: [{ value: '1080p', label: '1080p (required for native audio)' }],
      },
    ],
  },
];

describe('StudioForm conditional options', () => {
  it('uses the first matching rule and otherwise retains all options', () => {
    const resolution = fields[2];
    expect(studioSelectOptions(resolution, { model: 'kling-2.6', audio: 'native' })).toEqual([
      { value: '1080p', label: '1080p (required for native audio)' },
    ]);
    expect(studioSelectOptions(resolution, { model: 'kling-2.6', audio: 'off' })).toHaveLength(2);
  });

  it('preserves base translations and uses the rule label after correcting an invalid value', async () => {
    const Harness = () => {
      const [values, setValues] = useState({
        model: 'kling-2.6',
        audio: 'off',
        resolution: '720p',
      });
      return (
        <>
          <StudioForm
            fields={fields}
            values={values}
            onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
            provider="kling"
            operation="video"
            keyNs="kling_ai"
            tabKey="text-to-video"
          />
          <output data-testid="resolution">{values.resolution}</output>
        </>
      );
    };

    render(<Harness />);
    const resolution = screen.getByLabelText('Resolution') as HTMLSelectElement;
    expect(resolution.value).toBe('720p');
    expect(Array.from(resolution.options).map((option) => option.textContent)).toEqual([
      'Translated 720p',
      'Translated 1080p',
    ]);

    fireEvent.change(screen.getByLabelText('Audio'), { target: { value: 'native' } });
    await waitFor(() => expect(screen.getByTestId('resolution').textContent).toBe('1080p'));
    expect(resolution.value).toBe('1080p');
    expect(resolution.selectedOptions[0].textContent).toBe('1080p (required for native audio)');
  });
});
