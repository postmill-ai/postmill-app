import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignerElement } from '../designer.store';
import { FocalPointEditor } from './focal-point-editor';
import { detectFocalPoint } from '../reflow';

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => vi.fn() }));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: vi.fn() }) }));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, any>) => vars
    ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
        const value = String(vars[name]);
        return vars.interpolation?.escapeValue === false
          ? value
          : value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
      })
    : fallback,
}));
vi.mock('../elements', () => ({
  useLoadedImage: () => ({ naturalWidth: 400, naturalHeight: 200 }),
}));
vi.mock('../reflow', () => ({ detectFocalPoint: vi.fn() }));

const image = {
  id: 'image',
  originId: 'image-origin',
  type: 'image',
  src: '/image.png',
  x: 0,
  y: 0,
  width: 100,
  height: 200,
  naturalWidth: 400,
  naturalHeight: 200,
  fitMode: 'cover',
  focalPoint: { x: 0.5, y: 0.5 },
} as DesignerElement;

const makeStore = (element = image) => {
  const state = {
    doc: {
      mode: 'image',
      outputs: [{
        id: 'square', name: 'Square', formatId: 'square', width: 400, height: 400,
        children: [element],
      }, {
        id: 'portrait', name: 'Portrait', formatId: 'portrait', width: 400, height: 800,
        children: [{ ...image, id: 'portrait-image', focalPoint: { x: 1, y: 0.5 } }],
      }],
    },
    currentOutput: 0,
    currentPage: 0,
    updateElements: vi.fn(),
    updateElementsSilent: vi.fn(() => true),
    pushHistory: vi.fn(),
  };
  const store = Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  });
  return { store, state };
};

let viewportWidth: number;

beforeEach(() => {
  viewportWidth = 300;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(180);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, width: viewportWidth, height: 180,
    right: viewportWidth, bottom: 180, toJSON: () => ({}),
  }) as DOMRect);
});

afterEach(() => vi.restoreAllMocks());

describe('FocalPointEditor', () => {
  it('offers all nine quick positions', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    for (const y of [0, 50, 100]) {
      for (const x of [0, 50, 100]) {
        fireEvent.click(screen.getByRole('button', { name: `Set focal point: ${x}%, ${y}%` }));
        expect(store.getState().updateElements).toHaveBeenLastCalledWith([image.id], {
          focalPoint: { x: x / 100, y: y / 100 },
        });
      }
    }
    expect(store.getState().updateElements).toHaveBeenCalledTimes(9);
  });

  it('drags through silent updates and commits one history entry', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    const preview = screen.getByRole('group', { name: 'Focal point preview' });
    expect(screen.getByRole('button', { name: 'Auto-detect Subject' })).toBeTruthy();
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: 90 });
      Object.defineProperty(event, 'pointerId', { value: 4 });
      return event;
    };
    fireEvent(preview, pointerEvent('pointerdown', 210));
    fireEvent(preview, pointerEvent('pointermove', 240));
    fireEvent(preview, pointerEvent('pointerup', 240));
    expect(store.getState().updateElementsSilent).toHaveBeenCalledTimes(2);
    expect(store.getState().updateElementsSilent).toHaveBeenLastCalledWith([image.id], {
      focalPoint: { x: expect.closeTo(0.9, 8), y: 0.5 },
    });
    expect(store.getState().pushHistory).toHaveBeenCalledTimes(1);
  });

  it('uses current DOM geometry when the preview resizes during a drag', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    const preview = screen.getByRole('group', { name: 'Focal point preview' });
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: 90 });
      Object.defineProperty(event, 'pointerId', { value: 6 });
      return event;
    };
    fireEvent(preview, pointerEvent('pointerdown', 60));
    viewportWidth = 400;
    fireEvent(preview, pointerEvent('pointermove', 320));
    fireEvent(preview, pointerEvent('pointerup', 320));
    expect(store.getState().updateElementsSilent).toHaveBeenLastCalledWith([image.id], {
      focalPoint: { x: expect.closeTo(17 / 18, 8), y: 0.5 },
    });
  });

  it('does not add history for a click that leaves the crop unchanged', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    const preview = screen.getByRole('group', { name: 'Focal point preview' });
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: 90 });
    Object.defineProperty(event, 'pointerId', { value: 7 });
    fireEvent(preview, event);
    const up = new MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 90 });
    Object.defineProperty(up, 'pointerId', { value: 7 });
    fireEvent(preview, up);
    expect(store.getState().pushHistory).not.toHaveBeenCalled();
  });

  it('edits percentage fields silently and commits on blur', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    const x = screen.getByRole('spinbutton', { name: 'Focal X (%)' });
    fireEvent.change(x, { target: { value: '80' } });
    expect(store.getState().updateElementsSilent).toHaveBeenCalledWith([image.id], {
      focalPoint: { x: 0.8, y: 0.5 },
    });
    expect(store.getState().pushHistory).not.toHaveBeenCalled();
    fireEvent.blur(x);
    expect(store.getState().pushHistory).toHaveBeenCalledTimes(1);
  });

  it('resets only the focal point for the current selection', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset this format' }));
    expect(store.getState().updateElements).toHaveBeenCalledWith([image.id], {
      focalPoint: { x: 0.5, y: 0.5 },
    });
  });

  it('provides keyboard- and touch-reachable zoom in, out, and reset controls', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    const reset = screen.getByRole('button', { name: 'Reset preview zoom' });
    expect(reset.textContent).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(reset.textContent).toBe('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(reset.textContent).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(reset);
    expect(reset.textContent).toBe('100%');
    expect(store.getState().updateElementsSilent).not.toHaveBeenCalled();
  });

  it.each(['contain', 'fill'] as const)('explains why focal controls are inactive in %s mode', (fitMode) => {
    const element = { ...image, fitMode } as DesignerElement;
    const { store } = makeStore(element);
    render(<FocalPointEditor element={element} ids={[element.id]} store={store} />);
    expect(screen.getByText('Focal point applies when the image is cropped (Cover).')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Auto-detect Subject' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Focal X (%)' })).toBeNull();
  });

  it('does not discard an explicit crop when focal editing is unavailable', () => {
    const element = { ...image, crop: { x: 20, y: 0, width: 100, height: 200 } } as DesignerElement;
    const { store } = makeStore(element);
    render(<FocalPointEditor element={element} ids={[element.id]} store={store} />);
    expect(screen.getByText('Reset the explicit Crop below to adjust the focal point.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset this format' })).toBeNull();
    expect(store.getState().updateElements).not.toHaveBeenCalled();
  });

  it('uses each linked format’s own focal settings in its thumbnail', () => {
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    const thumbnail = screen.getByRole('img', { name: 'Portrait crop preview' }).querySelector('img');
    expect(thumbnail?.style.left).toBe('-300%');
    expect(thumbnail?.style.width).toBe('400%');
  });

  it('keeps literal output names in thumbnail accessible labels', () => {
    const { store, state } = makeStore();
    state.doc.outputs[0].name = 'Q&A';
    render(<FocalPointEditor element={image} ids={[image.id]} store={store} />);
    expect(screen.getByRole('img', { name: 'Q&A crop preview' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Q&amp;A crop preview' })).toBeNull();
  });

  it('keeps auto-detection as a compact title action', async () => {
    vi.mocked(detectFocalPoint).mockResolvedValue({ x: 0.2, y: 0.3 });
    const { store } = makeStore();
    render(<FocalPointEditor element={image} ids={[image.id, 'other-image']} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-detect Subject' }));
    await waitFor(() => expect(store.getState().updateElements).toHaveBeenCalledWith([image.id], {
      focalPoint: { x: 0.2, y: 0.3 },
    }));
  });
});
