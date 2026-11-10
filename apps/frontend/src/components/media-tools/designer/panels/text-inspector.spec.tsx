import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextInspector } from './text-inspector';
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
  measureForElement: () => undefined,
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
    fireEvent.click(screen.getByRole('button', { name: /Heading 1/ }));

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
    fireEvent.click(screen.getByRole('button', { name: /Heading 1/ }));
    fireEvent.click(screen.getByRole('button', { name: '#2B5CD3' }));
    const color = screen.getByRole('textbox', { name: 'Hex color' });
    fireEvent.change(color, { target: { value: '#abcdef' } });
    fireEvent.blur(color);

    expect(output(store, 1).pages?.[0].children[0]).toMatchObject({
      id: 'page-two',
      fontSize: 48,
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
});
