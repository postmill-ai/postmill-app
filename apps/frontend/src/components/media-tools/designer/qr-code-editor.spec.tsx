import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { QrCodeEditor } from './qr-code-editor';
import { DEFAULT_QR_CODE_SETTINGS, generateQrCode } from './qr-code';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('./controls', () => ({
  ColorSwatch: ({ label, onChange }: { label: string; onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange(label === 'Code color' ? '#112233' : '#AABBCC')}>{label}</button>
  ),
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

  it('previews independent foreground and background color changes before Apply', async () => {
    const view = render(<QrCodeEditor initialSettings={initial} submitLabel="Update" onSubmit={vi.fn()} />);

    fireEvent.click(view.getByRole('button', { name: 'Code color' }));
    fireEvent.click(view.getByRole('button', { name: 'Background color' }));

    const expected = await generateQrCode({ ...initial, foreground: '#112233', background: '#AABBCC' });
    await waitFor(() => {
      expect(view.getByRole('img', { name: 'QR code preview' }).getAttribute('src')).toBe(expected);
    });
  });
});
