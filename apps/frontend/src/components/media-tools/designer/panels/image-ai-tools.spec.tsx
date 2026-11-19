import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageAiTools } from './image-ai-tools';
import type { DesignerElement } from '../designer.store';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  aiImageToImage: vi.fn(),
  aiUpscale: vi.fn(),
  aiInpaint: vi.fn(),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetch,
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ operationAvailable: () => true }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));
vi.mock('../ai-image-actions', () => ({
  aiImageToImage: mocks.aiImageToImage,
  aiUpscale: mocks.aiUpscale,
  aiInpaint: mocks.aiInpaint,
  aiRemoveBackground: vi.fn(),
  applyAiRemoveBackground: vi.fn(),
}));
vi.mock('../outpaint-dialog', () => ({ OutpaintDialog: () => null }));
vi.mock('../outpaint', () => ({
  applyAiOutpaint: vi.fn(),
  applyWholePageOutpaint: vi.fn(),
  cleanupOutpaintCandidate: vi.fn(),
  prepareAiOutpaint: vi.fn(),
  prepareWholePageOutpaint: vi.fn(),
}));
vi.mock('../background-removal-dialog', () => ({ BackgroundRemovalDialog: () => null }));
vi.mock('../magic-grab', () => ({ prepareStaticMagicGrab: vi.fn(), applyStaticMagicGrab: vi.fn() }));
vi.mock('../magic-grab-modal', () => ({ openMagicGrabReview: vi.fn() }));

const element = (id = 'image-1') => ({
  id,
  type: 'image',
  src: `/uploads/${id}.png`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
}) as DesignerElement;
const store = { getState: () => ({ doc: { outputs: [{ width: 400, height: 300 }], currentOutput: 0 } }) };

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.aiImageToImage.mockReset();
  mocks.aiUpscale.mockReset();
  mocks.aiInpaint.mockReset();
});

describe('ImageAiTools', () => {
  it('groups each description, prompt, and Generate action in an accessible expandable card', async () => {
    mocks.aiImageToImage.mockResolvedValue(true);
    render(<ImageAiTools element={element()} store={store} />);
    const trigger = screen.getByRole('button', { name: 'Image to Image', exact: true });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Transform the selected image with a prompt while using it as the source.')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Transform the selected image with a prompt while using it as the source.')).toBeTruthy();
    const generate = screen.getByRole('button', { name: 'Generate', exact: true }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Image to Image' }), { target: { value: '  watercolor sketch  ' } });
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);

    await waitFor(() => expect(mocks.aiImageToImage).toHaveBeenCalledTimes(1));
    expect(mocks.aiImageToImage).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'image-1' }),
      'watercolor sketch'
    );
  });

  it('preserves a draft across collapse but not across a keyed target change', () => {
    const { rerender } = render(<ImageAiTools key="image-1" element={element('image-1')} store={store} />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Image to Image', exact: true }));
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Image to Image' }), { target: { value: 'first image draft' } });
    open();
    open();
    expect((screen.getByRole('textbox', { name: 'Image to Image' }) as HTMLInputElement).value).toBe('first image draft');

    rerender(<ImageAiTools key="image-2" element={element('image-2')} store={store} />);
    open();
    expect((screen.getByRole('textbox', { name: 'Image to Image' }) as HTMLInputElement).value).toBe('');
  });

  it('requires an inpaint prompt and mask before Generate', () => {
    render(<ImageAiTools element={element()} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inpaint', exact: true }));
    const generate = screen.getByRole('button', { name: 'Generate', exact: true }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Inpaint' }), { target: { value: 'remove the sign' } });
    expect(generate.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Draw mask…', exact: true })).toBeTruthy();
    expect(mocks.aiInpaint).not.toHaveBeenCalled();
  });
});
