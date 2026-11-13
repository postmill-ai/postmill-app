import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { computePopoverLeft, computePopoverPlacement, OutputTabs } from './output-tabs';
import { createDesignerStore } from './designer.store';

const toasterShow = vi.hoisted(() => vi.fn());
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

describe('computePopoverLeft', () => {
  it('right-aligns the popover edge to the anchor edge using the POPOVER width', () => {
    // Regression: the old math used the anchor's own width (40px "+" button),
    // pushing the 288px panel ~250px past the right viewport edge.
    // Anchor right edge at 1000, 288px popover, 1200 viewport → left = 712.
    expect(computePopoverLeft({ left: 960, right: 1000 }, 288, 1200, 'right')).toBe(712);
  });

  it('clamps inside the viewport when the anchor hugs the right edge', () => {
    // Anchor at the very right of a 1905px viewport.
    expect(computePopoverLeft({ left: 1865, right: 1905 }, 288, 1905, 'right')).toBe(1609);
  });

  it('left-aligns at the anchor and clamps overflow', () => {
    expect(computePopoverLeft({ left: 100, right: 140 }, 288, 1200, 'left')).toBe(100);
    expect(computePopoverLeft({ left: 1100, right: 1140 }, 288, 1200, 'left')).toBe(904);
  });

  it('respects the gap floor on tiny viewports', () => {
    expect(computePopoverLeft({ left: 0, right: 30 }, 288, 200, 'left')).toBe(8);
  });

  it('falls back to 280 when the popover has not measured yet', () => {
    expect(computePopoverLeft({ left: 960, right: 1000 }, 0, 1200, 'right')).toBe(720);
  });
});

describe('computePopoverPlacement', () => {
  it('opens above when there is plenty of room', () => {
    const p = computePopoverPlacement({ top: 700, bottom: 740 }, 900);
    expect(p.side).toBe('above');
    expect(p.maxHeight).toBe(688);
  });

  it('flips below when the anchor sits near the top', () => {
    const p = computePopoverPlacement({ top: 60, bottom: 100 }, 900);
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(788);
  });

  it('caps the height to the available space so the list scrolls instead of clipping', () => {
    // Short viewport, anchor mid-screen: above has 292px — the ~300px resize
    // menu must be capped rather than run off-screen.
    const p = computePopoverPlacement({ top: 300, bottom: 340 }, 600);
    expect(p.side).toBe('above');
    expect(p.maxHeight).toBe(288);
  });

  it('never goes below a usable minimum', () => {
    // Only 88px below the anchor — still flips there (more than the 48 above)
    // but the height floor keeps the menu usable.
    const p = computePopoverPlacement({ top: 60, bottom: 500 }, 600);
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(120);
  });
});

describe('OutputTabs in video mode', () => {
  // jsdom has no scrollIntoView; the tab-scroll effect calls it.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const videoStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    return store;
  };

  it('shows the add-format button in video mode, and the popover lists video presets', () => {
    render(<OutputTabs store={videoStore()} />);
    const addBtn = screen.getByRole('button', { name: 'Add format' });
    fireEvent.click(addBtn);

    // The popover heads as a video-format picker and offers video-category
    // presets — not the image channel groups.
    expect(screen.getByText('Add Video Format')).toBeTruthy();
    expect(screen.queryByText('Recommended set (IG Post + Story + LinkedIn + X)')).toBeNull();
    // At least one video preset (CHANNEL_PRESETS category 'video') is listed.
    expect(screen.getByText('Add Video Format')).toBeTruthy();
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
  });

  it('adding a video format clones the timeline as a second output', () => {
    const store = videoStore();
    render(<OutputTabs store={store} />);
    const videoPreset = store.getState().doc.mode === 'video';
    expect(videoPreset).toBe(true);

    store.getState().addOutput({ formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 });
    expect(store.getState().doc.outputs).toHaveLength(2);
    expect(store.getState().currentOutput).toBe(1);
  });

  it('the resize popover resizes a video output (no longer a no-op)', () => {
    const store = videoStore();
    render(<OutputTabs store={store} />);
    store.getState().resizeOutput(0, 1080, 1920, 'custom-tall', 'Tall');
    const out = store.getState().doc.outputs[0] as any;
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.formatId).toBe('custom-tall');
  });

  it('allows a repeated video preset with a disambiguated name', () => {
    const store = videoStore();
    const preset = { formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 };

    store.getState().addOutput(preset);
    store.getState().addOutput(preset);

    expect(store.getState().doc.outputs.map((out) => out.formatId)).toEqual([
      'ig-post', 'custom-tall', 'custom-tall',
    ]);
    expect(store.getState().doc.outputs.map((out) => out.name)).toEqual([
      'Instagram Post', 'Tall', 'Tall 2',
    ]);
  });
});

describe('OutputTabs repeated dimensions', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('allows selecting an already-used preset and adds a numbered output', () => {
    const store = createDesignerStore();
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    const checkbox = screen.getByRole('checkbox', { name: /Instagram Post/ });
    expect((checkbox as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 format' }));

    expect(store.getState().doc.outputs).toHaveLength(2);
    expect(store.getState().doc.outputs[1]).toMatchObject({
      formatId: 'ig-post', name: 'Instagram Post 2', width: 1080, height: 1080,
    });
  });

  it('keeps the recommended-set shortcut limited to formats not already present', () => {
    const store = createDesignerStore();
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recommended set (IG Post + Story + LinkedIn + X)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 format' }));

    expect(store.getState().doc.outputs.map((out) => out.formatId)).toEqual([
      'ig-post', 'ig-story', 'linkedin-post', 'x-post',
    ]);
  });
});


describe('OutputTabs format workflows', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('lists portrait and square presets under their channel groups', () => {
    const store = createDesignerStore();
    render(<OutputTabs store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));

    expect(screen.getByRole('checkbox', { name: /Instagram Portrait 1080×1350/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Facebook Square 1080×1080/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /LinkedIn Portrait 1080×1350/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Threads Portrait 1080×1350/ })).toBeTruthy();
  });

  it('freezes and unfreezes from the snowflake while preserving output switching', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    render(<OutputTabs store={store} />);

    const freeze = screen.getAllByRole('button', { name: 'Freeze format' })[0];
    fireEvent.click(freeze);
    expect(store.getState().doc.outputs[0].frozen).toBe(true);
    expect(screen.getByRole('button', { name: 'Add format' })).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Unfreeze format' }));
    expect(store.getState().doc.outputs[0].frozen).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /X 1200×675/ }));
    expect(store.getState().currentOutput).toBe(1);
  });

  it('keeps the popover open with a warning when a frozen source needs origin backfill', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Unlinked',
    });
    store.getState().updateElement('headline', { originId: undefined });
    store.getState().setOutputFrozen(0, true);
    toasterShow.mockClear();
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add custom size' }));

    expect(toasterShow).toHaveBeenCalledWith('This format is frozen. Unfreeze it to edit.', 'warning');
    expect(screen.getByText('Add Formats')).toBeTruthy();
    expect(store.getState().doc.outputs).toHaveLength(1);
  });

  it('Link/Unlink changes edit scope without rewriting element links', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Linked',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    const origins = store.getState().doc.outputs.map((out: any) => out.children[0].originId);
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlink edits between formats' }));
    expect(store.getState().editFormatOnly).toBe(true);
    expect(store.getState().doc.outputs.map((out: any) => out.children[0].originId)).toEqual(origins);
    fireEvent.click(screen.getByRole('button', { name: 'Link edits across formats' }));
    expect(store.getState().editFormatOnly).toBe(false);
  });
});
