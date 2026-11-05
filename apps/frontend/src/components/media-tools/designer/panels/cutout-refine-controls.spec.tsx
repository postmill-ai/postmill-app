import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CutoutRefineControls } from './cutout-refine-controls';
import { createDesignerStore, type DesignerElement } from '../designer.store';
import { primeBufferFromSrc } from '../raster-layers';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('../raster-layers', () => ({
  primeBufferFromSrc: vi.fn(),
}));

const setup = (withMask: boolean) => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: 'image-1', type: 'image', x: 0, y: 0, width: 200, height: 100,
    src: '/cutout.png', originalSrc: withMask ? '/original.png' : undefined,
    maskSrc: withMask ? '/mask.png' : undefined,
    maskEnabled: true,
  } as DesignerElement);
  return store;
};

describe('CutoutRefineControls', () => {
  beforeEach(() => {
    vi.mocked(primeBufferFromSrc).mockResolvedValue(undefined);
  });

  it('offers Restore, Erase, before/after, brush settings, and Done', async () => {
    const store = setup(true);
    render(<CutoutRefineControls store={store} targetId="image-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore', exact: true }));
    await waitFor(() => expect(store.getState().maskTargetId).toBe('image-1'));
    expect(store.getState().activeTool).toBe('brush');
    expect(store.getState().toolOptions.brush?.color).toBe('#ffffff');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Brush size' }), { target: { value: '48' } });
    expect(store.getState().toolOptions.brush?.size).toBe(48);

    fireEvent.click(screen.getByRole('button', { name: 'Erase', exact: true }));
    await waitFor(() => expect(store.getState().activeTool).toBe('eraser'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Brush hardness' }), { target: { value: '65' } });
    expect(store.getState().toolOptions.eraser?.hardness).toBe(65);

    fireEvent.click(screen.getByRole('button', { name: 'Show original', exact: true }));
    expect(store.getState().doc.outputs[0].children[0].maskEnabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
    expect(store.getState().maskTargetId).toBeNull();
    expect(store.getState().activeTool).toBe('move');
  });

  it('is honest when a flattened cutout has no original background', () => {
    const store = setup(false);
    render(<CutoutRefineControls store={store} targetId="image-1" />);
    expect(screen.getByText('Original background is unavailable for this flattened cutout.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Restore/Erase mask' })).toBeTruthy();
  });
});
