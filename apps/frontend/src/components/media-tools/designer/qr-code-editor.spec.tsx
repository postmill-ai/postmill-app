import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { QrCodeEditor } from './qr-code-editor';
import { DEFAULT_QR_CODE_SETTINGS } from './qr-code';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('./controls', () => ({
  ColorSwatch: () => <div />,
  Stepper: () => <div />,
}));

const initial = { ...DEFAULT_QR_CODE_SETTINGS, value: 'https://postmill.ai' };

describe('QrCodeEditor drafts', () => {
  it('preserves typing across equivalent setting objects and resets only for a real settings change', () => {
    const view = render(<QrCodeEditor initialSettings={initial} submitLabel="Update" onSubmit={vi.fn()} />);
    const input = view.getByPlaceholderText('https://example.com or plain text');
    fireEvent.change(input, { target: { value: 'https://postmill.ai/draft' } });

    view.rerender(<QrCodeEditor initialSettings={{ ...initial }} submitLabel="Update" onSubmit={vi.fn()} />);
    expect((view.getByPlaceholderText('https://example.com or plain text') as HTMLTextAreaElement).value)
      .toBe('https://postmill.ai/draft');

    view.rerender(
      <QrCodeEditor
        initialSettings={{ ...initial, value: 'https://postmill.ai/changed' }}
        submitLabel="Update"
        onSubmit={vi.fn()}
      />
    );
    expect((view.getByPlaceholderText('https://example.com or plain text') as HTMLTextAreaElement).value)
      .toBe('https://postmill.ai/changed');
  });
});
