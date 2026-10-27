import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudioForm } from './studio-form';
import { studioSelectOptions, type StudioField } from './types';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
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
    options: [{ value: 'native', label: 'Native audio' }],
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

  it('corrects a newly invalid value so the submitted request matches the visible option', async () => {
    const Harness = () => {
      const [values, setValues] = useState({
        model: 'kling-2.6',
        audio: 'native',
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
    await waitFor(() => expect(screen.getByTestId('resolution').textContent).toBe('1080p'));
    expect((screen.getByLabelText('Resolution') as HTMLSelectElement).value).toBe('1080p');
  });
});
