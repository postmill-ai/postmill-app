import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasInspector } from './canvas-inspector';
import { createDesignerStore, type VideoOutput } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
vi.mock('./use-brand-colors', () => ({ useBrandColors: () => [] }));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));

afterEach(cleanup);

const videoStore = () => {
  const store = createDesignerStore(400, 400);
  store.getState().setMode('video');
  return store;
};

const output = (store: ReturnType<typeof videoStore>) =>
  store.getState().doc.outputs[0] as VideoOutput;

describe('CanvasInspector video background', () => {
  it('offers the Designer color presets without exposing image-only controls', () => {
    const store = videoStore();
    render(<CanvasInspector store={store} />);

    expect(screen.getByText('Background')).toBeTruthy();
    expect(screen.getByText('Custom color')).toBeTruthy();
    expect(screen.getByText('Duration · {{fps}} fps')).toBeTruthy();
    expect(screen.queryByText('Canvas size')).toBeNull();
    expect(screen.queryByText('Gradient')).toBeNull();
    expect(screen.queryByText('Texture')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Blue', exact: true }));

    expect(output(store).bg).toEqual({ type: 'color', color: '#2B5CD3' });
    expect('background' in output(store)).toBe(false);
    expect(screen.getByRole('button', { name: 'Blue', exact: true }).className).toContain('border-designerAccent');
  });

  it('applies and displays a custom video background color', () => {
    const store = videoStore();
    render(<CanvasInspector store={store} />);

    fireEvent.click(screen.getByRole('button', { name: '#000000', exact: true }));
    const hex = screen.getByRole('textbox', { name: 'Hex color' });
    fireEvent.change(hex, { target: { value: '#B61A32' } });
    fireEvent.keyDown(hex, { key: 'Enter' });

    expect(output(store).bg).toEqual({ type: 'color', color: '#B61A32' });
    expect(screen.getByRole('button', { name: '#B61A32', exact: true })).toBeTruthy();
  });
});
