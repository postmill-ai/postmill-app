import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DesktopWorkspacePanel,
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
vi.mock('./panels/brand-panel', () => ({ BrandPanel: () => <div>Brand panel content</div> }));
vi.mock('./panels/canvas-inspector', () => ({ CanvasInspector: () => <div>Canvas panel content</div> }));
vi.mock('./panels/inspector-panel', () => ({ InspectorPanel: () => <div>Inspector panel content</div> }));
vi.mock('./panels/layers-panel', () => ({ LayersPanel: () => <div>Layers panel content</div> }));
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
    collapsed,
  };
  return { ...render(<DesktopWorkspacePanel {...props} />), props };
};

beforeEach(() => localStorage.clear());

describe('DesktopWorkspacePanel', () => {
  it('offers Inspector, Layers, Brand and AI through the shared tabs', () => {
    const { props } = renderPanel('inspector');
    for (const name of ['Inspector', 'Layers', 'Brand', 'AI']) {
      expect(screen.getAllByRole('tab', { name, exact: true }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getAllByRole('tab', { name: 'Brand', exact: true })[0]);
    expect(props.onTabChange).toHaveBeenCalledWith('brand');
  });

  it('keeps AI and Brand mounted while hiding inactive panels', () => {
    const { rerender, props } = renderPanel('inspector');
    expect(screen.getByText('Canvas panel content')).toBeDefined();
    expect(screen.queryByText('Layers panel content')).toBeNull();
    expect(screen.getByText('Brand panel content').closest('[hidden]')).not.toBeNull();
    expect(screen.getByText('AI panel content').closest('[hidden]')).not.toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="layers" />);
    expect(screen.getByText('Layers panel content')).toBeDefined();
    expect(screen.getByText('Layers footer content')).toBeDefined();
    expect(screen.getByText('Canvas panel content').closest('[hidden]')).not.toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" />);
    expect(screen.getByText('Brand panel content').closest('[hidden]')).toBeNull();
    expect(screen.getByText('AI panel content').closest('[hidden]')).not.toBeNull();
    expect(screen.queryByText('Layers panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="ai" />);
    expect(screen.getByText('AI panel content').closest('[hidden]')).toBeNull();
    expect(screen.getByText('Brand panel content').closest('[hidden]')).not.toBeNull();
  });

  it('preserves paid results through tab changes and panel collapse', () => {
    const { rerender, props } = renderPanel('ai');
    fireEvent.click(screen.getByText('Complete paid generation'));
    expect(screen.getByText('Paid generation result')).toBeDefined();

    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" />);
    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" collapsed />);
    rerender(<DesktopWorkspacePanel {...props} activeTab="ai" />);
    expect(screen.getByText('Paid generation result')).toBeDefined();
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

  it('falls back safely for malformed saved values', () => {
    localStorage.setItem('designer-workspace-panel-org', '{broken');
    expect(readDesktopWorkspacePreference(localStorage, 'org')).toEqual({
      activeTab: 'inspector', collapsed: false,
    });
  });
});
