import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MobileQuickActions, MobileToolsDialog, MobileToolsSheet, MobileWorkspaceSheet } from './mobile-designer-tools';
import { createDesignerStore, type VideoOutput } from './designer.store';

const imageElement = {
  id: 'image-1', type: 'image' as const, x: 0, y: 0, width: 100, height: 100,
  rotation: 0, opacity: 1, locked: false, hidden: false, src: '/image.png',
};

describe('MobileQuickActions', () => {
  it('exposes tools and Inspector and performs static selection actions', async () => {
    const store = createDesignerStore();
    const onSave = vi.fn();
    const onOpenTools = vi.fn();
    const onToggleInspector = vi.fn();
    render(<MobileQuickActions store={store} onSave={onSave} onOpenTools={onOpenTools} onToggleInspector={onToggleInspector} />);

    expect(screen.getByRole('button', { name: 'Undo', exact: true }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Duplicate', exact: true }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tools', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspector', exact: true }));
    expect(onOpenTools).toHaveBeenCalledOnce();
    expect(onToggleInspector).toHaveBeenCalledOnce();

    act(() => {
      store.getState().addElement(imageElement);
      store.getState().setSelectedIds(['image-1']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate', exact: true }));
    expect((store.getState().doc.outputs[0] as any).children).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect((store.getState().doc.outputs[0] as any).children).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('batches static multi-duplicate and multi-delete into one undo entry each', () => {
    const store = createDesignerStore();
    act(() => {
      store.getState().addElement(imageElement);
      store.getState().addElement({ ...imageElement, id: 'image-2' });
      store.getState().setSelectedIds(['image-1', 'image-2']);
    });
    render(<MobileQuickActions store={store} onSave={vi.fn()} onOpenTools={vi.fn()} onToggleInspector={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate', exact: true }));
    expect((store.getState().doc.outputs[0] as any).children).toHaveLength(4);
    expect(store.getState().selectedIds).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect((store.getState().doc.outputs[0] as any).children).toHaveLength(2);

    act(() => store.getState().setSelectedIds(['image-1', 'image-2']));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect((store.getState().doc.outputs[0] as any).children).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect((store.getState().doc.outputs[0] as any).children).toHaveLength(2);
  });

  it('uses the selected video clip and reacts to track lock changes', async () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const trackId = output.tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'clip-1', startMs: 0, endMs: 1000, src: '/image.png',
      x: 0, y: 0, width: 100, height: 100,
    });
    const selected = { outputIndex: 0, trackId, clipId: 'clip-1' };
    store.getState().setSelectedClip(selected);
    store.getState().setSelectedClips([{ trackId, clipId: 'clip-1' }]);
    render(<MobileQuickActions store={store} onSave={vi.fn()} onOpenTools={vi.fn()} onToggleInspector={vi.fn()} />);

    act(() => store.getState().setTrackLocked(0, trackId, true));
    expect(screen.getByRole('button', { name: 'Duplicate', exact: true }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete', exact: true }).disabled).toBe(true);
    act(() => store.getState().setTrackLocked(0, trackId, false));
    expect(screen.getByRole('button', { name: 'Duplicate', exact: true }).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate', exact: true }));
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips).toHaveLength(2);
    act(() => {
      store.getState().setSelectedClips([{ trackId, clipId: 'clip-1' }]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips).toHaveLength(1);
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips[0].id).not.toBe('clip-1');
  });
});

describe('MobileToolsSheet', () => {
  it('uses the shared tool registry and opens Brand', async () => {
    const onSelect = vi.fn();
    const onOpenBrand = vi.fn();
    render(
      <MobileToolsSheet
        activeTool="move"
        lastToolPerGroup={{}}
        aiAvailable
        onSelect={onSelect}
        activeToolOptions={{}}
        onToolOptionChange={vi.fn()}
        onOpenBrand={onOpenBrand}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Horizontal Type', exact: true }));
    expect(onSelect).toHaveBeenCalledWith('type-horizontal');
    fireEvent.click(screen.getByRole('button', { name: 'Brand', exact: true }));
    expect(onOpenBrand).toHaveBeenCalledOnce();
  });
});

describe('MobileToolsDialog', () => {
  it('keeps the active tool, options, and option writes live while open', () => {
    const store = createDesignerStore();
    const LiveHarness = () => {
      const activeTool = store((state) => state.activeTool);
      const lastToolPerGroup = store((state) => state.lastToolPerGroup);
      const activeToolOptions = store((state) => state.toolOptions[activeTool]);
      return (
        <MobileToolsDialog
          open
          onClose={vi.fn()}
          activeTool={activeTool}
          lastToolPerGroup={lastToolPerGroup}
          aiAvailable
          onSelect={(toolId) => store.getState().setActiveTool(toolId)}
          activeToolOptions={activeToolOptions || {}}
          onToolOptionChange={(key, value) => store.getState().setToolOption(activeTool, key, value)}
          onOpenBrand={vi.fn()}
        />
      );
    };
    render(<LiveHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle', exact: true }));
    expect(screen.getByRole('button', { name: 'Rectangle', exact: true }).getAttribute('aria-pressed')).toBe('true');
    const radius = screen.getByRole('spinbutton', { name: 'Radius', exact: true });
    fireEvent.change(radius, { target: { value: '24' } });
    expect(store.getState().toolOptions['shape-rect']?.cornerRadius).toBe(24);
    expect(store.getState().toolOptions.move).toBeUndefined();
  });
});

describe('MobileWorkspaceSheet', () => {
  it('is non-modal and switches between half, expanded, and collapsed states', () => {
    const onClose = vi.fn();
    render(
      <MobileWorkspaceSheet open title="Inspector" onClose={onClose}>
        <div>Panel content</div>
      </MobileWorkspaceSheet>
    );
    const sheet = screen.getByRole('region', { name: 'Inspector' });
    expect(sheet.className).toContain('h-[32dvh]');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand', exact: true }));
    expect(sheet.className).toContain('h-[65dvh]');
    fireEvent.click(screen.getByRole('button', { name: 'Half', exact: true }));
    expect(sheet.className).toContain('h-[32dvh]');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel', exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('continues resizing when pointer capture finds no active pointer', () => {
    const original = Element.prototype.setPointerCapture;
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(() => {
        throw new DOMException('No active pointer', 'NotFoundError');
      }),
    });
    try {
      render(
        <MobileWorkspaceSheet open title="Inspector" onClose={vi.fn()}>
          <div>Panel content</div>
        </MobileWorkspaceSheet>
      );
      const handle = screen.getByRole('button', { name: 'Resize Inspector panel' });
      const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 100 });
      Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
      expect(() => fireEvent(handle, pointerDown)).not.toThrow();
      expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
      expect(() => fireEvent.pointerCancel(handle, { pointerId: 1 })).not.toThrow();
    } finally {
      Object.defineProperty(Element.prototype, 'setPointerCapture', {
        configurable: true,
        value: original,
      });
    }
  });
});
