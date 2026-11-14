import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InspectorPanel } from './inspector-panel';
import { createDesignerStore, type DesignerElement } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('./common-inspector', () => ({ CommonInspector: () => null }));
vi.mock('./image-inspector', () => ({ ImageInspector: () => null }));
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
  it('shows Unlink as an enabled action for linked page-one text', () => {
    const store = createDesignerStore();
    store.getState().addElement(text('text', 'shared'));
    store.getState().setSelectedIds(['text']);
    render(<InspectorPanel store={store} />);

    expect(screen.getByText(/Linked — edits update all formats/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlink' }).className).toContain('text-btnPrimaryAccent');
  });

  it('keeps origin metadata on a later page from claiming cross-format edits', () => {
    const store = createDesignerStore();
    store.getState().addPage();
    store.getState().addElement(text('local', 'page-local-origin'));
    store.getState().setSelectedIds(['local']);
    render(<InspectorPanel store={store} />);

    expect(screen.getByText(/This format only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply to All Formats' })).toBeNull();
  });
});
