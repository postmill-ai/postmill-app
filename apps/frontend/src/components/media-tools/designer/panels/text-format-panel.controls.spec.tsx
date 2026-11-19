import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitTextToBox, type MeasureText } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import { TextFormatPanel } from './text-format-panel';
import {
  createDesignerStore,
  type DesignerElement,
  type DesignerOutput,
} from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));

vi.mock('./use-brand-colors', () => ({ useBrandColors: () => [] }));
vi.mock('./use-brand-fonts', async (importOriginal) => ({
  ...(await importOriginal()),
  useBrandFonts: () => [],
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => async () => ({ ok: true, json: async () => [] }),
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('../fonts', () => ({
  DESIGNER_FONTS: [],
  ensureFontLoaded: () => Promise.resolve(),
}));

vi.mock('../measure-text', () => ({
  fittedFontSize: (element: { fontSize?: number }) => element.fontSize ?? 16,
  growBoxFor: () => ({}),
  measureForElement: () => undefined,
}));

const measure: MeasureText = (text, size) => text.length * size * 0.5;

const fitted = (element: DesignerElement) =>
  fitTextToBox(
    {
      text: element.text ?? '',
      width: element.width,
      height: element.height,
      fontSize: element.fontSize ?? 16,
      lineHeight: element.lineHeight,
      letterSpacing: element.letterSpacing,
      autoFit: element.autoFit,
      minFontSize: element.autoFitMinFontSize,
    },
    measure
  );

const renderPanel = async (overrides: Partial<DesignerElement> = {}) => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: 'copy',
    type: 'text',
    x: 0,
    y: 0,
    width: 300,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Summer sale this weekend only at our downtown store',
    fontSize: 40,
    fontFamily: 'Inter',
    fill: '#000000',
    ...overrides,
  } as DesignerElement);
  store.getState().setSelectedIds(['copy']);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TextFormatPanel store={store} />
    </SWRConfig>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return store;
};

const element = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as DesignerOutput).children[0];

const autoFitSwitch = () =>
  screen.getByRole('switch', { name: 'Auto-fit text', exact: true });

afterEach(cleanup);

describe('TextFormatPanel auto-fit controls', () => {
  it('restores legacy fitting after enabling and disabling auto-fit', async () => {
    const store = await renderPanel();
    const before = element(store);
    expect(before.autoFit).toBeUndefined();
    const beforeFit = fitted(before);

    fireEvent.click(autoFitSwitch());
    expect(element(store).autoFit).toBe(true);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minimum font size' }), {
      target: { value: '6' },
    });
    expect(element(store).autoFitMinFontSize).toBe(6);

    fireEvent.click(autoFitSwitch());
    const after = element(store);
    expect(after.autoFit).toBeUndefined();
    expect(after.autoFitMinFontSize).toBeUndefined();
    expect(fitted(after)).toEqual(beforeFit);
  });

  it('returns newly created explicit-off text to false', async () => {
    const store = await renderPanel({ autoFit: false });

    fireEvent.click(autoFitSwitch());
    expect(element(store).autoFit).toBe(true);
    fireEvent.click(autoFitSwitch());

    expect(element(store).autoFit).toBe(false);
  });

  it('clamps the minimum to the authored font size', async () => {
    const store = await renderPanel({ autoFit: true, fontSize: 16 });
    const minimum = screen.getByRole('spinbutton', { name: 'Minimum font size' });

    fireEvent.change(minimum, { target: { value: '99' } });

    expect(element(store).autoFitMinFontSize).toBe(16);
    expect((minimum as HTMLInputElement).value).toBe('16');
  });
});
