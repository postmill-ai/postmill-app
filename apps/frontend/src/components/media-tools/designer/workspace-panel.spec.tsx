import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DesktopWorkspacePanel,
  isMobileDesignerViewport,
  readDesktopWorkspacePreference,
  writeDesktopWorkspacePreference,
  type WorkspaceTab,
} from './workspace-panel';
import { createDesignerStore } from './designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('./panels/ai-panel', () => ({
  AiPanel: () => {
    const [complete, setComplete] = useState(false);
    return (
      <div>
        <span>AI panel content</span>
        <button onClick={() => setComplete(true)}>Complete paid generation</button>
        {complete && <span>Paid generation result</span>}
      </div>
    );
  },
}));
vi.mock('./panels/elements-panel', () => ({
  ElementsPanel: () => {
    const [query, setQuery] = useState('');
    return (
      <div>
        <span>Elements panel content</span>
        <input aria-label="Elements search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <span>Stock request pending</span>
      </div>
    );
  },
}));
vi.mock('./panels/brand-panel', () => ({ BrandPanel: () => <div>Brand panel content</div> }));
vi.mock('./panels/canvas-inspector', () => ({ CanvasInspector: () => <div>Canvas panel content</div> }));
vi.mock('./panels/inspector-panel', () => ({ InspectorPanel: () => <div>Inspector panel content</div> }));
vi.mock('./panels/layers-panel', () => ({
  LayersPanel: ({ store }: { store: any }) => (
    <div>
      <span>Layers panel content</span>
      <button onClick={() => store.getState().setSelectedIds(['one'])}>Select one layer</button>
      <button onClick={() => store.getState().setSelectedIds(['one', 'two'])}>Multi-select layers</button>
      <button onDoubleClick={() => store.getState().requestRename('one')}>Rename layer</button>
    </div>
  ),
}));
vi.mock('./panels/layers-footer', () => ({ LayersFooter: () => <div>Layers footer content</div> }));

const renderPanel = (activeTab: WorkspaceTab, onTabChange = vi.fn(), collapsed = false) => {
  const store = createDesignerStore();
  const props = {
    store,
    activeTab,
    onTabChange,
    onClose: vi.fn(),
    hasInspectorTarget: false,
    currentOutput: 0,
    currentOutputSizeKey: '1080x1080',
    onInsertMedia: vi.fn(),
    collapsed,
  };
  return { ...render(<DesktopWorkspacePanel {...props} />), props };
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('DesktopWorkspacePanel', () => {
  it('offers Inspector, Layers, Elements, Brand and AI through the shared tabs', () => {
    const { props } = renderPanel('inspector');
    for (const name of ['Inspector', 'Layers', 'Elements', 'Brand', 'AI']) {
      expect(screen.getAllByRole('tab', { name, exact: true }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getAllByRole('tab', { name: 'Elements', exact: true })[0]);
    expect(props.onTabChange).toHaveBeenCalledWith('elements');
  });

  it('mounts AI and Brand on first activation and keeps them hidden afterwards', async () => {
    const { rerender, props } = renderPanel('inspector');
    expect(screen.getByText('Canvas panel content')).toBeDefined();
    expect(screen.queryByText('Layers panel content')).toBeNull();
    expect(screen.queryByText('Brand panel content')).toBeNull();
    expect(screen.queryByText('AI panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="layers" />);
    expect(screen.getByText('Layers panel content')).toBeDefined();
    expect(screen.getByText('Layers footer content')).toBeDefined();
    expect(screen.queryByText('Brand panel content')).toBeNull();
    expect(screen.queryByText('AI panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" />);
    expect((await screen.findByText('Brand panel content')).closest('[hidden]')).toBeNull();
    expect(screen.queryByText('AI panel content')).toBeNull();
    expect(screen.queryByText('Layers panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="ai" />);
    expect((await screen.findByText('AI panel content')).closest('[hidden]')).toBeNull();
    expect(screen.getByText('Brand panel content').closest('[hidden]')).not.toBeNull();
  });

  it('lazy-mounts Elements and preserves its search and pending request across tabs and collapse', async () => {
    const { rerender, props } = renderPanel('inspector');
    expect(screen.queryByText('Elements panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="elements" />);
    const search = await screen.findByRole('textbox', { name: 'Elements search' });
    fireEvent.change(search, { target: { value: 'free mountains' } });
    expect(screen.getByText('Stock request pending')).toBeDefined();

    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" />);
    expect(screen.getByText('Elements panel content').closest('[hidden]')).not.toBeNull();
    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" collapsed />);
    rerender(<DesktopWorkspacePanel {...props} activeTab="elements" />);
    expect(screen.getByRole('textbox', { name: 'Elements search' })).toHaveProperty('value', 'free mountains');
    expect(screen.getByText('Stock request pending')).toBeDefined();
  });

  it('does not mount a saved active heavy panel until the collapsed workspace expands', async () => {
    const { rerender, props } = renderPanel('ai', vi.fn(), true);
    expect(screen.queryByText('AI panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} collapsed={false} />);
    expect(await screen.findByText('AI panel content')).toBeDefined();
    rerender(<DesktopWorkspacePanel {...props} collapsed />);
    expect(screen.getByText('AI panel content').closest('[hidden]')).not.toBeNull();
  });

  it('keeps Layers active through selection, multi-select and rename', () => {
    const { props } = renderPanel('layers');
    fireEvent.click(screen.getByText('Select one layer'));
    expect(props.store.getState().selectedIds).toEqual(['one']);
    expect(screen.getByText('Layers panel content')).toBeDefined();

    fireEvent.click(screen.getByText('Multi-select layers'));
    expect(props.store.getState().selectedIds).toEqual(['one', 'two']);
    fireEvent.doubleClick(screen.getByText('Rename layer'));
    expect(props.store.getState().renamingId).toBe('one');
    expect(screen.getByText('Layers panel content')).toBeDefined();
    expect(props.onTabChange).not.toHaveBeenCalled();
  });

  it('preserves paid results through tab changes and panel collapse', async () => {
    const { rerender, props } = renderPanel('ai');
    fireEvent.click(await screen.findByText('Complete paid generation'));
    expect(screen.getByText('Paid generation result')).toBeDefined();

    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" />);
    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" collapsed />);
    rerender(<DesktopWorkspacePanel {...props} activeTab="ai" />);
    expect(screen.getByText('Paid generation result')).toBeDefined();
  });
});

describe('responsive workspace initialization', () => {
  it('detects a phone viewport before desktop preferences can open the sheet', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    expect(isMobileDesignerViewport()).toBe(true);
  });

  it('allows desktop preferences on a desktop viewport', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    expect(isMobileDesignerViewport()).toBe(false);
  });
});

describe('desktop workspace preferences', () => {
  it('adopts the legacy Layers and Brand open preferences', () => {
    localStorage.setItem('designer-layers-panel-org', JSON.stringify({ open: true }));
    expect(readDesktopWorkspacePreference(localStorage, 'org')).toEqual({
      activeTab: 'layers', collapsed: false,
    });
    localStorage.setItem('designer-brand-panel-org', JSON.stringify({ open: true }));
    expect(readDesktopWorkspacePreference(localStorage, 'org').activeTab).toBe('brand');
  });

  it('persists the active tab and collapsed state per organization', () => {
    writeDesktopWorkspacePreference(localStorage, 'org', {
      activeTab: 'ai', collapsed: true,
    });
    expect(readDesktopWorkspacePreference(localStorage, 'org')).toEqual({
      activeTab: 'ai', collapsed: true,
    });
    expect(readDesktopWorkspacePreference(localStorage, 'other')).toEqual({
      activeTab: 'inspector', collapsed: false,
    });
  });

  it('persists Elements as the active tab', () => {
    writeDesktopWorkspacePreference(localStorage, 'org', {
      activeTab: 'elements', collapsed: false,
    });
    expect(readDesktopWorkspacePreference(localStorage, 'org')).toEqual({
      activeTab: 'elements', collapsed: false,
    });
  });

  it('falls back safely for malformed saved values', () => {
    localStorage.setItem('designer-workspace-panel-org', '{broken');
    expect(readDesktopWorkspacePreference(localStorage, 'org')).toEqual({
      activeTab: 'inspector', collapsed: false,
    });
  });
});
