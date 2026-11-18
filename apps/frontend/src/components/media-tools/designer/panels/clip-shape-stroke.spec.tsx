import React, { act } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClipInspector } from './clip-inspector';
import { createDesignerStore } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ operationAvailable: () => false }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), close: vi.fn(), element: null }),
}));
vi.mock('./font-family-picker', () => ({ FontFamilyPicker: () => null }));

const makeStore = (
  shape: 'rect' | 'ellipse' | 'star' | 'triangle' | 'polygon' | 'line' = 'rect',
  style: { stroke?: string; strokeWidth?: number } = { stroke: '#123456', strokeWidth: 2 },
) => {
  const store = createDesignerStore(400, 300);
  store.getState().loadDesign({
    version: 5,
    mode: 'video',
    outputs: [{
      id: 'out-shape',
      width: 400,
      height: 300,
      durationMs: 1000,
      fps: 30,
      tracks: [{
        id: 'track-shape',
        type: 'shape',
        clips: [{
          id: 'clip-shape',
          startMs: 0,
          endMs: 1000,
          shape,
          x: 50,
          y: 50,
          width: 100,
          height: 80,
          fill: '#ff0000',
          ...style,
        }],
      }],
    }],
  } as any, 'shape-stroke', 'Shape stroke');
  return store;
};

const currentClip = (store: ReturnType<typeof makeStore>) =>
  (store.getState().doc.outputs[0] as any).tracks[0].clips[0];

const strokeGroup = () => screen.getByRole('group', { name: 'Stroke', exact: true });

describe('ClipInspector shape stroke controls', () => {
  it.each(['rect', 'ellipse', 'star', 'triangle', 'polygon'] as const)(
    'exposes color and bounded width for %s clips',
    (shape) => {
      const store = makeStore(shape);
      render(<ClipInspector store={store} outputIndex={0} trackId="track-shape" clipId="clip-shape" />);

      const group = strokeGroup();
      expect(within(group).getByRole('button', { name: /#123456/ })).toBeTruthy();
      expect(within(group).getByRole('spinbutton', { name: 'Width', exact: true })).toHaveProperty('max', '40');
    }
  );

  it('does not replace the existing line semantics with closed-shape controls', () => {
    const store = makeStore('line');
    render(<ClipInspector store={store} outputIndex={0} trackId="track-shape" clipId="clip-shape" />);
    expect(screen.queryByRole('group', { name: 'Stroke', exact: true })).toBeNull();
  });

  it('keeps text outlines on textStroke instead of the closed-shape fields', () => {
    const store = makeStore('rect', {});
    const doc = store.getState().doc as any;
    doc.outputs[0].tracks[0].type = 'text';
    const clip = doc.outputs[0].tracks[0].clips[0];
    delete clip.shape;
    clip.text = 'Outlined';
    clip.textStroke = { color: '#123456', width: 3 };
    store.getState().loadDesign(doc, 'text-stroke', 'Text stroke');
    render(<ClipInspector store={store} outputIndex={0} trackId="track-shape" clipId="clip-shape" />);

    expect(screen.queryByRole('group', { name: 'Stroke', exact: true })).toBeNull();
    const width = screen.getByRole('spinbutton', { name: 'Outline width', exact: true });
    fireEvent.change(width, { target: { value: '4' } });
    fireEvent.blur(width);
    expect(currentClip(store).textStroke).toEqual({ color: '#123456', width: 4 });
    expect(currentClip(store).stroke).toBeUndefined();
    expect(currentClip(store).strokeWidth).toBeUndefined();
  });

  it('commits one color edit and retains that color across zero and restored widths', () => {
    const store = makeStore();
    render(<ClipInspector store={store} outputIndex={0} trackId="track-shape" clipId="clip-shape" />);
    const initialHistory = store.getState().history.length;

    fireEvent.click(within(strokeGroup()).getByRole('button', { name: /#123456/ }));
    const color = screen.getByRole('textbox', { name: 'Hex color', exact: true });
    fireEvent.change(color, { target: { value: '#abcdef' } });
    fireEvent.keyDown(color, { key: 'Enter' });
    expect(currentClip(store).stroke).toBe('#ABCDEF');
    expect(store.getState().history).toHaveLength(initialHistory + 1);

    const width = within(strokeGroup()).getByRole('spinbutton', { name: 'Width', exact: true });
    fireEvent.change(width, { target: { value: '0' } });
    fireEvent.blur(width);
    expect(currentClip(store)).toMatchObject({ stroke: '#ABCDEF', strokeWidth: 0 });

    fireEvent.change(width, { target: { value: '6' } });
    fireEvent.blur(width);
    expect(currentClip(store)).toMatchObject({ stroke: '#ABCDEF', strokeWidth: 6 });
    expect(store.getState().history).toHaveLength(initialHistory + 3);
  });

  it('clamps width and commits a typed edit once on blur', () => {
    const store = makeStore();
    render(<ClipInspector store={store} outputIndex={0} trackId="track-shape" clipId="clip-shape" />);
    const initialHistory = store.getState().history.length;
    const width = within(strokeGroup()).getByRole('spinbutton', { name: 'Width', exact: true });

    fireEvent.change(width, { target: { value: '100' } });
    fireEvent.change(width, { target: { value: '40' } });
    fireEvent.blur(width);
    expect(currentClip(store).strokeWidth).toBe(40);
    expect(store.getState().history).toHaveLength(initialHistory + 1);

    fireEvent.change(width, { target: { value: '-10' } });
    fireEvent.blur(width);
    expect(currentClip(store).strokeWidth).toBe(0);
    act(() => store.getState().undo());
    expect(currentClip(store).strokeWidth).toBe(40);
  });

  it('writes the effective color when enabling a legacy stroke in one edit', () => {
    const store = makeStore('rect', { strokeWidth: 0 });
    render(<ClipInspector store={store} outputIndex={0} trackId="track-shape" clipId="clip-shape" />);
    const initialHistory = store.getState().history.length;
    const width = within(strokeGroup()).getByRole('spinbutton', { name: 'Width', exact: true });

    fireEvent.change(width, { target: { value: '4' } });
    fireEvent.blur(width);

    expect(currentClip(store)).toMatchObject({ stroke: '#ff0000', strokeWidth: 4 });
    expect(store.getState().history).toHaveLength(initialHistory + 1);
  });
});
