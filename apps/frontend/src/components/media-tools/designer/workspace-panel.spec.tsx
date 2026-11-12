import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesktopWorkspacePanel, type WorkspaceTab } from './workspace-panel';
import { createDesignerStore } from './designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('./panels/ai-panel', () => ({ AiPanel: () => <div>AI panel content</div> }));
vi.mock('./panels/brand-panel', () => ({ BrandPanel: () => <div>Brand panel content</div> }));
vi.mock('./panels/canvas-inspector', () => ({ CanvasInspector: () => <div>Canvas panel content</div> }));
vi.mock('./panels/inspector-panel', () => ({ InspectorPanel: () => <div>Inspector panel content</div> }));
vi.mock('./panels/layers-panel', () => ({ LayersPanel: () => <div>Layers panel content</div> }));
vi.mock('./panels/layers-footer', () => ({ LayersFooter: () => <div>Layers footer content</div> }));

const renderPanel = (activeTab: WorkspaceTab, onTabChange = vi.fn()) => {
  const store = createDesignerStore();
  const props = {
    store,
    activeTab,
    onTabChange,
    onClose: vi.fn(),
    hasInspectorTarget: false,
    currentOutput: 0,
    currentOutputSizeKey: '1080x1080',
  };
  return { ...render(<DesktopWorkspacePanel {...props} />), props };
};

describe('DesktopWorkspacePanel', () => {
  it('offers Inspector, Layers, Brand and AI through the shared tabs', () => {
    const { props } = renderPanel('inspector');
    for (const name of ['Inspector', 'Layers', 'Brand', 'AI']) {
      expect(screen.getAllByRole('tab', { name, exact: true }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getAllByRole('tab', { name: 'Brand', exact: true })[0]);
    expect(props.onTabChange).toHaveBeenCalledWith('brand');
  });

  it('mounts only the active heavy panel', () => {
    const { rerender, props } = renderPanel('inspector');
    expect(screen.getByText('Canvas panel content')).toBeDefined();
    expect(screen.queryByText('Layers panel content')).toBeNull();
    expect(screen.queryByText('Brand panel content')).toBeNull();
    expect(screen.queryByText('AI panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="layers" />);
    expect(screen.getByText('Layers panel content')).toBeDefined();
    expect(screen.getByText('Layers footer content')).toBeDefined();
    expect(screen.queryByText('Canvas panel content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="brand" />);
    expect(screen.getByText('Brand panel content')).toBeDefined();
    expect(screen.queryByText('Layers panel content')).toBeNull();
    expect(screen.queryByText('Layers footer content')).toBeNull();

    rerender(<DesktopWorkspacePanel {...props} activeTab="ai" />);
    expect(screen.getByText('AI panel content')).toBeDefined();
    expect(screen.queryByText('Brand panel content')).toBeNull();
  });
});
