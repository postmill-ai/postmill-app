import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MobileQuickActions, MobileToolsSheet } from './mobile-designer-tools';
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

  it('uses the selected video clip for duplicate and multi-clip deletion', async () => {
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
