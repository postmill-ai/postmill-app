import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BackgroundRemovalDialog } from './background-removal-dialog';

describe('BackgroundRemovalDialog', () => {
  it('compares before/after and applies the selected fit', async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <BackgroundRemovalDialog
        originalUrl="/before.png"
        asset={{ url: '/after.png' }}
        onApply={onApply}
        onCancel={onCancel}
      />
    );

    expect((await screen.findByRole('img', { name: 'Before' })).getAttribute('src')).toBe('/before.png');
    expect((await screen.findByRole('img', { name: 'After' })).getAttribute('src')).toBe('/after.png');
    fireEvent.click(screen.getByRole('button', { name: 'Apply result' }));
    expect(onApply).toHaveBeenLastCalledWith('frame');
    await screen.findByRole('button', { name: 'Apply result' });

    fireEvent.click(screen.getByRole('radio', { name: /Fit to canvas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply result' }));
    expect(onApply).toHaveBeenLastCalledWith('canvas');
    await screen.findByRole('button', { name: 'Apply result' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
