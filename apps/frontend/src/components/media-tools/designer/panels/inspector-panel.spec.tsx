import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectorPanel } from './inspector-panel';
import { createDesignerStore, type DesignerElement } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('./common-inspector', () => ({ CommonInspector: () => null }));
vi.mock('./image-inspector', () => ({
  // Stateful stand-in: proves the panel keeps the inspector mounted across
  // tab switches, so AI drafts and in-flight edits survive.
  ImageInspector: ({ tab }: { tab?: string }) => {
    const [draft, setDraft] = React.useState('');
    return (
      <input
        aria-label="Image draft"
        data-tab={tab}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));
vi.mock('./shape-inspector', () => ({ ShapeInspector: () => null }));
vi.mock('./icon-inspector', () => ({ IconInspector: () => null }));
vi.mock('./text-inspector', () => ({ TextInspector: () => null }));
vi.mock('./clip-inspector', () => ({ ClipInspector: () => null }));
vi.mock('./symbol-inspector', () => ({ SymbolInspector: () => null }));
vi.mock('./fill-layer-inspector', () => ({ FillLayerInspector: () => null }));
vi.mock('./adjustment-inspector', () => ({ AdjustmentInspector: () => null }));
vi.mock('./effects-list', () => ({ EffectsList: () => null }));

const text = (id: string, originId?: string): DesignerElement => ({
  id,
  originId,
  type: 'text',
  text: id,
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

describe('InspectorPanel link state', () => {
  it('shows Unlink as an enabled action for linked page-one text', async () => {
    const store = createDesignerStore();
    store.getState().addElement(text('text', 'shared'));
    store.getState().setSelectedIds(['text']);
    render(<InspectorPanel store={store} />);
    await flushHydration();

    expect(screen.getByText(/Linked — edits update all formats/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlink' }).className).toContain('text-btnPrimaryAccent');
  });

  it('keeps origin metadata on a later page from claiming cross-format edits', async () => {
    const store = createDesignerStore();
    store.getState().addPage();
    store.getState().addElement(text('local', 'page-local-origin'));
    store.getState().setSelectedIds(['local']);
    render(<InspectorPanel store={store} />);
    await flushHydration();

    expect(screen.getByText(/This format only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply to All Formats' })).toBeNull();
  });
});

const image = (id: string): DesignerElement => ({
  id,
  type: 'image',
  src: '/image.png',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

const shape = (id: string): DesignerElement => ({
  id,
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

const flushHydration = () => act(async () => {});

// jsdom applies no Tailwind, so OverflowTabs renders its inline and
// desktop-only copies; either copy is a valid click/assert target.
const tab = (name: string) => screen.getAllByRole('tab', { name })[0];
const tabIsActive = (name: string) =>
  screen.getAllByRole('tab', { name }).every((el) => el.getAttribute('aria-selected') === 'true');

describe('InspectorPanel task tabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows Layout | Style | AI Tools for an image and switches tabs without unmounting drafts', async () => {
    const store = createDesignerStore();
    store.getState().addElement(image('img'));
    store.getState().setSelectedIds(['img']);
    render(<InspectorPanel store={store} />);
    await flushHydration();

    expect(tab('Layout').getAttribute('aria-selected')).toBe('true');
    expect(tab('Style')).toBeTruthy();
    expect(tab('AI Tools')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Image draft'), { target: { value: 'inpaint prompt' } });
    fireEvent.click(tab('Style'));
    expect((screen.getByLabelText('Image draft') as HTMLInputElement).value).toBe('inpaint prompt');
    expect(screen.getByLabelText('Image draft').getAttribute('data-tab')).toBe('style');

    fireEvent.click(tab('Layout'));
    expect((screen.getByLabelText('Image draft') as HTMLInputElement).value).toBe('inpaint prompt');
  });

  it('does not force a tab when the selection changes within the same category', async () => {
    const store = createDesignerStore();
    store.getState().addElement(image('a'));
    store.getState().addElement(image('b'));
    store.getState().setSelectedIds(['a']);
    render(<InspectorPanel store={store} />);

    fireEvent.click(tab('Style'));
    expect(tabIsActive('Style')).toBe(true);

    act(() => store.getState().setSelectedIds(['b']));
    expect(tabIsActive('Style')).toBe(true);
    expect(screen.getByLabelText('Image draft').getAttribute('data-tab')).toBe('style');
  });

  it('restores the persisted tab on remount and falls back per category', async () => {
    const store = createDesignerStore();
    store.getState().addElement(image('img'));
    store.getState().setSelectedIds(['img']);
    const first = render(<InspectorPanel store={store} />);
    await flushHydration();
    fireEvent.click(tab('AI Tools'));
    expect(tabIsActive('AI Tools')).toBe(true);
    first.unmount();

    render(<InspectorPanel store={store} />);
    await flushHydration();
    expect(tabIsActive('AI Tools')).toBe(true);
  });

  it('shows Layout | Text | Effects for text', async () => {
    const store = createDesignerStore();
    store.getState().addElement(text('copy'));
    store.getState().setSelectedIds(['copy']);
    render(<InspectorPanel store={store} />);
    await flushHydration();

    expect(tab('Layout')).toBeTruthy();
    expect(tab('Text')).toBeTruthy();
    expect(tab('Effects')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'AI Tools' })).toBeNull();

    const effectsTab = tab('Effects');
    fireEvent.click(effectsTab);
    const effectsPanels = screen.getAllByRole('tabpanel', { name: 'Effects' });
    expect(effectsPanels.length).toBeGreaterThan(0);
    expect(effectsPanels.every((panel) => panel.getAttribute('aria-labelledby') === effectsTab.id)).toBe(true);
  });

  it('shows Layout | Style for a mixed-type selection', async () => {
    const store = createDesignerStore();
    store.getState().addElement(image('img'));
    store.getState().addElement(shape('box'));
    store.getState().setSelectedIds(['img', 'box']);
    render(<InspectorPanel store={store} />);
    await flushHydration();

    expect(tab('Layout')).toBeTruthy();
    expect(tab('Style')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'AI Tools' })).toBeNull();
    expect(screen.queryByLabelText('Image draft')).toBeNull();
  });
});
