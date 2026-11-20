import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageInspector } from './image-inspector';
import { IconInspector } from './icon-inspector';
import { ShapeInspector } from './shape-inspector';
import { createDesignerStore, type DesignerElement } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ operationAvailable: () => true }),
}));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));
vi.mock('./use-brand-colors', () => ({ useBrandColors: () => [] }));
vi.mock('../elements', () => ({
  getImageNaturalSize: () => null,
  useLoadedImage: () => null,
}));
vi.mock('../use-preset-preview', () => ({
  usePresetPreview: () => ({ preview: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('./cutout-refine-controls', () => ({ CutoutRefineControls: () => null }));

const element = (input: Partial<DesignerElement> & Pick<DesignerElement, 'type'>): DesignerElement => ({
  id: input.id || 'element',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  ...input,
}) as DesignerElement;

const storeWith = (el: DesignerElement) => {
  const store = createDesignerStore();
  store.getState().addElement(el);
  return { store, selected: store.getState().doc.outputs[0].children![0] };
};

const expectVisible = (el: HTMLElement) => expect(el.closest('[hidden]')).toBeNull();
const expectHidden = (el: HTMLElement) => expect(el.closest('[hidden]')).not.toBeNull();

describe('Inspector tab control ownership', () => {
  it('keeps image fitting controls on Layout and AI operations on AI Tools', () => {
    const { store, selected } = storeWith(element({ type: 'image', src: '/image.png' }));
    const { rerender } = render(
      <ImageInspector element={selected} ids={[selected.id]} store={store} tab="layout" />,
    );

    for (const name of ['Fit to frame', 'Fit to canvas', 'Center']) {
      for (const control of screen.getAllByRole('button', { name, exact: true })) expectVisible(control);
    }
    expectHidden(screen.getByRole('button', { name: 'Remove Background', exact: true, hidden: true }));

    rerender(<ImageInspector element={selected} ids={[selected.id]} store={store} tab="ai" />);
    expectVisible(screen.getByRole('button', { name: 'Remove Background', exact: true }));
    for (const name of ['Fit to frame', 'Fit to canvas', 'Center']) {
      for (const control of screen.getAllByRole('button', { name, exact: true, hidden: true })) expectHidden(control);
    }
  });

  it.each([
    ['star', 'Points'],
    ['polygon', 'Sides'],
  ] as const)('keeps shape %s geometry on Layout', (shape, label) => {
    const { store, selected } = storeWith(element({ type: 'shape', shape }));
    const { rerender } = render(
      <ShapeInspector element={selected} ids={[selected.id]} store={store} tab="layout" />,
    );

    expectVisible(screen.getByLabelText(label));
    rerender(<ShapeInspector element={selected} ids={[selected.id]} store={store} tab="style" />);
    expectHidden(screen.getByLabelText(label));
  });

  it('keeps icon size on Layout', () => {
    const { store, selected } = storeWith(element({ type: 'icon', src: '/icon.png' }));
    const { rerender } = render(
      <IconInspector element={selected} ids={[selected.id]} store={store} tab="layout" />,
    );

    expectVisible(screen.getByLabelText('W'));
    expectVisible(screen.getByLabelText('H'));
    rerender(<IconInspector element={selected} ids={[selected.id]} store={store} tab="style" />);
    expectHidden(screen.getByLabelText('W'));
    expectHidden(screen.getByLabelText('H'));
  });
});
