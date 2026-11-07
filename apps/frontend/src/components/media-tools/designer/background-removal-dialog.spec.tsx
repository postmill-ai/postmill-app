import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BackgroundRemovalDialog } from './background-removal-dialog';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

describe('BackgroundRemovalDialog', () => {
  it('defaults to preserving the existing crop, fit and focal geometry', () => {
    const onApply = vi.fn();
    render(
      <BackgroundRemovalDialog
        originalUrl="/before.png"
        asset={{ url: '/cutout.png' }}
        onApply={onApply}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('radio', { name: 'Keep manual geometry' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply result' }));
    expect(onApply).toHaveBeenCalledWith('manual');
  });
});
