import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { designShareUrl, ShareDialog } from './share-dialog';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback,
    ),
}));

describe('design sharing', () => {
  it('builds a deep link to the saved design', () => {
    expect(designShareUrl('design-123', 'https://app.postmill.ai'))
      .toBe('https://app.postmill.ai/media/designer?designId=design-123');
  });

  it('copies the deep link and controls collaboration', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onToggleCollaboration = vi.fn();
    render(
      <ShareDialog
        designId="design-123"
        initialCollabEnabled={false}
        connectedCount={0}
        onToggleCollaboration={onToggleCollaboration}
      />,
    );

    expect(screen.getByDisplayValue('http://localhost:3000/media/designer?designId=design-123')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/media/designer?designId=design-123');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enable collaboration' }));
    expect(onToggleCollaboration).toHaveBeenCalledWith(true);
    expect(screen.getByText('0 connected')).toBeTruthy();
  });
});
