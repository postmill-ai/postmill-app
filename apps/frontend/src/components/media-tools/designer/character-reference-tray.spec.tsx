import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterReferenceTray } from './character-reference-tray';

const picker = vi.hoisted(() => ({ options: null as any }));
const show = vi.hoisted(() => vi.fn());

vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: (options: unknown) => {
    picker.options = options;
    return { open: vi.fn(), element: null };
  },
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback,
}));

beforeEach(() => {
  picker.options = null;
  show.mockReset();
});

afterEach(cleanup);

describe('CharacterReferenceTray', () => {
  it('uses the multi-image file picker and preserves selection order', () => {
    const onChange = vi.fn();
    render(<CharacterReferenceTray value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reference images' }));
    expect(picker.options).toMatchObject({ kinds: ['image'], multiple: true, requireFile: true });

    act(() => {
      picker.options.onConfirm([
        { fileId: 'char-1', url: '/uploads/char-1.png', name: 'Front', type: 'image' },
        { fileId: 'char-2', url: '/uploads/char-2.png', name: 'Side', type: 'image' },
      ]);
    });
    expect(onChange).toHaveBeenCalledWith([
      { fileId: 'char-1', src: '/uploads/char-1.png', name: 'Front' },
      { fileId: 'char-2', src: '/uploads/char-2.png', name: 'Side' },
    ]);
  });

  it('removes a saved reference and rejects selections above three images', () => {
    const onChange = vi.fn();
    render(
      <CharacterReferenceTray
        value={[{ fileId: 'char-1', src: '/uploads/char-1.png', name: 'Hero' }]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hero' }));
    expect(onChange).toHaveBeenCalledWith([]);

    act(() => {
      picker.options.onConfirm(Array.from({ length: 4 }, (_, index) => ({
        fileId: `char-${index}`,
        url: `/uploads/char-${index}.png`,
        type: 'image',
      })));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith('Choose up to 3 reference images.', 'warning');
  });
});
