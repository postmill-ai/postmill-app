import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageFilterControls } from './image-filter-controls';
import type { DesignerElement } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const element = (filters: string[] = [], id = 'image-1') => ({
  id,
  type: 'image',
  src: 'https://cdn.example.com/photo.png',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  filters,
}) as DesignerElement;

const updateElements = vi.fn();
const updateElementsSilent = vi.fn(() => true);
const pushHistory = vi.fn();
let selectedElements: DesignerElement[] = [];
const store = {
  getState: () => ({
    doc: { outputs: [{ children: selectedElements }] },
    currentOutput: 0,
    currentPage: 0,
    updateElements,
    updateElementsSilent,
    pushHistory,
  }),
};

beforeEach(() => {
  selectedElements = [element()];
  updateElements.mockClear();
  updateElementsSilent.mockClear();
  pushHistory.mockClear();
});

describe('ImageFilterControls', () => {
  it('uses the selected image for preset thumbnails and applies a look to every selected image', () => {
    render(<ImageFilterControls element={element(['saturate:1.4', 'contrast:1.1'])} ids={['image-1', 'image-2']} store={store} />);
    const vivid = screen.getByRole('button', { name: 'Vivid', exact: true });
    expect(vivid.getAttribute('aria-pressed')).toBe('true');
    expect(vivid.querySelector('span')?.getAttribute('style')).toContain('photo.png');

    fireEvent.click(screen.getByRole('button', { name: 'Mono', exact: true }));
    expect(updateElements).toHaveBeenCalledWith(['image-1', 'image-2'], { filters: ['grayscale'] });
  });

  it('clears exact preset selection after a manual edit and resets every token', () => {
    const { rerender } = render(<ImageFilterControls element={element(['grayscale'])} ids={['image-1']} store={store} />);
    expect(screen.getByRole('button', { name: 'Mono', exact: true }).getAttribute('aria-pressed')).toBe('true');
    rerender(<ImageFilterControls element={element(['grayscale', 'blur:1'])} ids={['image-1']} store={store} />);
    expect(screen.getByRole('button', { name: 'Mono', exact: true }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Reset all', exact: true }));
    expect(updateElements).toHaveBeenCalledWith(['image-1'], { filters: [] });
  });

  it('shows neutral adjustments as percentages and commits one Undo after pointer-up and blur', () => {
    render(<ImageFilterControls element={element()} ids={['image-1']} store={store} />);
    const brightness = screen.getByRole('slider', { name: 'Brightness', exact: true });
    expect((brightness as HTMLInputElement).value).toBe('100');
    expect(screen.getAllByText('100%')).toHaveLength(3);

    fireEvent.change(brightness, { target: { value: '150' } });
    expect(updateElementsSilent).toHaveBeenCalledWith(['image-1'], { filters: ['brightness:1.5'] });
    fireEvent.pointerUp(brightness);
    fireEvent.blur(brightness);
    expect(pushHistory).toHaveBeenCalledTimes(1);
    expect(pushHistory).toHaveBeenCalledWith('Adjust image filters');
  });

  it('disables Reset all when the image has no filters', () => {
    render(<ImageFilterControls element={element()} ids={['image-1']} store={store} />);
    expect((screen.getByRole('button', { name: 'Reset all', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('changes only the adjusted token on each selected image', () => {
    selectedElements = [
      element(['grayscale']),
      element(['sepia', 'contrast:1.2'], 'image-2'),
    ];
    render(<ImageFilterControls element={selectedElements[0]} ids={['image-1', 'image-2']} store={store} />);
    const brightness = screen.getByRole('slider', { name: 'Brightness', exact: true });
    fireEvent.change(brightness, { target: { value: '105' } });

    expect(updateElementsSilent).toHaveBeenCalledTimes(2);
    expect(updateElementsSilent).toHaveBeenNthCalledWith(1, ['image-1'], {
      filters: ['grayscale', 'brightness:1.05'],
    });
    expect(updateElementsSilent).toHaveBeenNthCalledWith(2, ['image-2'], {
      filters: ['sepia', 'contrast:1.2', 'brightness:1.05'],
    });
    fireEvent.pointerUp(brightness);
    expect(pushHistory).toHaveBeenCalledTimes(1);
  });

  it('shows standalone sepia and removes it without clearing other adjustments', () => {
    selectedElements = [element(['sepia', 'brightness:1.1'])];
    render(<ImageFilterControls element={selectedElements[0]} ids={['image-1']} store={store} />);
    const sepia = screen.getByRole('switch', { name: 'Sepia', exact: true });
    expect(sepia.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sepia);

    expect(updateElementsSilent).toHaveBeenCalledWith(['image-1'], { filters: ['brightness:1.1'] });
    expect(pushHistory).toHaveBeenCalledTimes(1);
    expect(pushHistory).toHaveBeenCalledWith('Adjust image filters');
  });
});
