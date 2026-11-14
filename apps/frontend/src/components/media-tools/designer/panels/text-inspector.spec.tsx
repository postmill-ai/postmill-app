import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextInspector } from './text-inspector';
import { ensureFontLoaded } from '../fonts';
import {
  createDesignerStore,
  type DesignerElement,
  type DesignerOutput,
} from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(vars[name]))
        : fallback,
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
  ensureFontLoaded: vi.fn(() => Promise.resolve()),
}));

vi.mock('../measure-text', () => ({
  fittedFontSize: (element: { fontSize?: number }) => element.fontSize ?? 16,
  measureForElement: () => (line: string, size: number) => line.length * size * 0.5,
  fitStyleBoxFor: (
    element: { text?: string; width: number; height: number; lineHeight?: number },
    fontSize: number,
    _measure: unknown,
    shrinkHeight = false,
  ) => {
    const lines = Math.ceil((element.text?.length ?? 0) * fontSize * 0.5 / Math.max(1, element.width));
    const height = Math.ceil(Math.max(1, lines) * (element.lineHeight || 1.2) * fontSize);
    return height > element.height || (shrinkHeight && height < element.height) ? { height } : {};
  },
}));

vi.mock('./designer-assistant-panel', () => ({
  DesignerAssistantPanel: () => null,
}));

type Store = ReturnType<typeof createDesignerStore>;

const textElement = (id: string, text: string): DesignerElement =>
  ({
    id,
    type: 'text',
    text,
    x: 120,
    y: 80,
    width: 240,
    height: 60,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fontSize: 16,
    fontFamily: 'Inter',
    fill: '#123456',
  }) as DesignerElement;

const output = (store: Store, index: number) =>
  store.getState().doc.outputs[index] as DesignerOutput;

const renderInspector = async (store: Store) => {
  const rendered = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TextInspector store={store} />
    </SWRConfig>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return rendered;
};

const clickStyle = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {
    await Promise.resolve();
  });
};

const createSecondOutputPageTwoSelection = () => {
  const store = createDesignerStore();
  store.getState().addElement(textElement('page-one', 'Page one'));
  store.getState().addOutput({ formatId: 'story', name: 'Story', width: 1080, height: 1920 });
  store.getState().addPage();
  store.getState().addElement(textElement('page-two', 'Page two'));
  store.getState().setSelectedIds(['page-two']);
  return store;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('TextInspector paged text', () => {
  it('keeps page 1 controls and linked-output edits unchanged', async () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('page-one', 'Page one'));
    store.getState().addOutput({ formatId: 'story', name: 'Story', width: 1080, height: 1920 });
    store.getState().setCurrentOutput(0);
    store.getState().setSelectedIds(['page-one']);
    await renderInspector(store);

    expect(screen.getByText('Text Styles')).toBeTruthy();
    expect(screen.getByText('Pairings')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Text formatting' })).toBeTruthy();
    await clickStyle(/Heading 1/);

    expect(output(store, 0).children[0]).toMatchObject({ id: 'page-one', fontSize: 48, fontWeight: 700 });
    expect(output(store, 1).children[0]).toMatchObject({ fontFamily: 'Inter', fontWeight: 700, lineHeight: 1.1 });
  });

  it('shows page 2 controls and edits only the selected page text', async () => {
    const store = createSecondOutputPageTwoSelection();
    const linkedPageOneFontSize = output(store, 1).children[0].fontSize;
    store.getState().setOutputBackground({ type: 'color', color: '#000000' });
    await renderInspector(store);

    expect(screen.getByText('Text Styles')).toBeTruthy();
    expect(screen.getByText('Pairings')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Text formatting' })).toBeTruthy();
    expect(screen.getByText(/Low contrast/)).toBeTruthy();
    await clickStyle(/Heading 1/);
    fireEvent.click(screen.getByRole('button', { name: '#123456' }));
    const color = screen.getByRole('textbox', { name: 'Hex color' });
    fireEvent.change(color, { target: { value: '#abcdef' } });
    fireEvent.blur(color);

    expect(output(store, 1).pages?.[0].children[0]).toMatchObject({
      id: 'page-two',
      fontSize: 64,
      fontWeight: 700,
      fill: '#ABCDEF',
    });
    expect(output(store, 1).children[0]).toMatchObject({ fontSize: linkedPageOneFontSize, fill: '#123456' });
    expect(output(store, 0).children[0]).toMatchObject({ fontSize: 16, fill: '#123456' });
    expect(output(store, 0).pages).toBeUndefined();
  });

  it('adds and groups a backdrop with the primary text on page 2 only', async () => {
    const store = createSecondOutputPageTwoSelection();
    await renderInspector(store);

    fireEvent.click(screen.getByRole('button', { name: 'Add Text Backdrop' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const pageOne = output(store, 1).children;
    const pageTwo = output(store, 1).pages?.[0].children ?? [];
    const backdrop = pageTwo.find((element) => element.name === 'Text Backdrop');
    const primary = pageTwo.find((element) => element.id === 'page-two');
    expect(backdrop).toMatchObject({
      type: 'shape',
      x: 112,
      y: 76,
      width: 256,
      height: 68,
    });
    expect(primary?.parentId).toBe(backdrop?.parentId);
    expect(primary?.parentId).toBeTruthy();
    expect(pageOne).toHaveLength(1);
    expect(pageOne[0].name).not.toBe('Text Backdrop');
    expect(output(store, 0).pages).toBeUndefined();
  });

  it('preserves colors and rich-run typography when applying a style', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      ...textElement('rich', 'Rich text'),
      fill: '#123456',
      fillGradient: {
        type: 'linear',
        angle: 45,
        stops: [
          { offset: 0, color: '#111111' },
          { offset: 1, color: '#eeeeee' },
        ],
      },
      richText: [
        { text: 'Rich', fill: '#aa0000', fontFamily: 'Georgia', fontSize: 18, fontWeight: 400 },
        { text: ' text', fill: '#00aa00', fontFamily: 'Arial', fontSize: 28, fontWeight: 700 },
      ],
    });
    store.getState().setSelectedIds(['rich']);
    await renderInspector(store);

    await clickStyle(/Heading 1/);

    const current = output(store, 0).children[0];
    expect(current.fill).toBe('#123456');
    expect(current.fillGradient?.angle).toBe(45);
    expect(current.richText?.map((run) => run.fill)).toEqual(['#aa0000', '#00aa00']);
    expect(current.richText?.map((run) => run.fontFamily)).toEqual(['Georgia', 'Arial']);
    expect(current.richText?.map((run) => run.fontSize)).toEqual([18, 28]);
    expect(current.richText?.map((run) => run.fontWeight)).toEqual([400, 700]);
    expect(current.fontSize).toBe(48);
  });

  it('uses bounded canvas-relative sizing with a stable style hierarchy', async () => {
    const store = createDesignerStore(1200, 675);
    store.getState().addElement(textElement('heading', 'Heading'));
    store.getState().setSelectedIds(['heading']);
    await renderInspector(store);

    await clickStyle(/Heading 1/);
    expect(output(store, 0).children[0].fontSize).toBe(40);
    await clickStyle('B Body');

    const current = output(store, 0).children[0];
    expect(current.fontSize).toBe(13);
    expect(current.height).toBe(60);
    expect(store.getState().doc.outputs[0]).toMatchObject({ width: 1200, height: 675 });
  });

  it('resolves the preset font before committing measured growth', async () => {
    let resolveFont = () => {};
    vi.mocked(ensureFontLoaded).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFont = resolve;
    }));
    const store = createDesignerStore();
    store.getState().addElement(textElement('deferred', 'A much longer heading'));
    store.getState().setSelectedIds(['deferred']);
    await renderInspector(store);
    const depth = store.getState().history.length;

    fireEvent.click(screen.getByRole('button', { name: /Heading 1/ }));
    expect(store.getState().doc.outputs[0].children[0].fontSize).toBe(16);
    expect(store.getState().history).toHaveLength(depth);

    resolveFont();
    await waitFor(() => expect(output(store, 0).children[0].fontSize).toBe(48));
    expect(ensureFontLoaded).toHaveBeenCalledWith('Inter', [700], false);
    expect(output(store, 0).children[0].height).toBe(159);
    expect(store.getState().history).toHaveLength(depth + 1);
  });

  it('keeps the clicked style when the pointer leaves before its font resolves', async () => {
    let resolveFont = () => {};
    vi.mocked(ensureFontLoaded).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFont = resolve;
    }));
    const store = createDesignerStore();
    store.getState().addElement(textElement('deferred-leave', 'A much longer heading'));
    store.getState().setSelectedIds(['deferred-leave']);
    await renderInspector(store);
    const depth = store.getState().history.length;
    const heading = screen.getByRole('button', { name: /Heading 1/ });

    fireEvent.click(heading);
    fireEvent.mouseLeave(heading);
    expect(output(store, 0).children[0].fontSize).toBe(16);

    resolveFont();
    await waitFor(() => expect(output(store, 0).children[0].fontSize).toBe(48));
    expect(output(store, 0).children[0].height).toBe(159);
    expect(store.getState().history).toHaveLength(depth + 1);
  });

  it('does not push history when the text is removed before its font resolves', async () => {
    let resolveFont = () => {};
    vi.mocked(ensureFontLoaded).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFont = resolve;
    }));
    const store = createDesignerStore();
    store.getState().addElement(textElement('deferred-delete', 'A much longer heading'));
    store.getState().setSelectedIds(['deferred-delete']);
    await renderInspector(store);

    fireEvent.click(screen.getByRole('button', { name: /Heading 1/ }));
    act(() => { store.getState().removeElement('deferred-delete'); });
    const depth = store.getState().history.length;

    await act(async () => {
      resolveFont();
      await Promise.resolve();
    });
    expect(output(store, 0).children).toHaveLength(0);
    expect(store.getState().history).toHaveLength(depth);
  });

  it('shrinks feature-grown boxes only back to their remembered authored height', async () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('grown', 'A much longer heading'));
    store.getState().setSelectedIds(['grown']);
    await renderInspector(store);

    await clickStyle(/Heading 1/);
    expect(output(store, 0).children[0].height).toBe(159);
    await clickStyle('B Body');
    expect(output(store, 0).children[0].height).toBe(60);
    await clickStyle(/Heading 1/);
    expect(output(store, 0).children[0].height).toBe(159);
    await clickStyle('Reset style');
    expect(output(store, 0).children[0].height).toBe(60);
  });

  it('ignores a stale slow-font apply after a newer preset wins', async () => {
    let resolveHeading = () => {};
    let resolveBody = () => {};
    vi.mocked(ensureFontLoaded)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveHeading = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveBody = resolve; }));
    const store = createDesignerStore();
    store.getState().addElement(textElement('raced', 'Race'));
    store.getState().setSelectedIds(['raced']);
    await renderInspector(store);
    const depth = store.getState().history.length;

    fireEvent.click(screen.getByRole('button', { name: /Heading 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'B Body' }));
    resolveBody();
    await waitFor(() => expect(output(store, 0).children[0].fontSize).toBe(16));
    expect(store.getState().history).toHaveLength(depth + 1);

    resolveHeading();
    await act(async () => { await Promise.resolve(); });
    expect(output(store, 0).children[0].fontSize).toBe(16);
    expect(store.getState().history).toHaveLength(depth + 1);
  });
});
