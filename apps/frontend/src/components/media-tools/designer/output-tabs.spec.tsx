import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { computePopoverLeft, computePopoverPlacement, OutputTabs } from './output-tabs';
import { createDesignerStore } from './designer.store';
import { MAX_OUTPUTS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';

const toasterShow = vi.hoisted(() => vi.fn());
const promptOpen = vi.hoisted(() => vi.fn());
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toasterShow }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  usePromptModal: () => ({ open: promptOpen }),
}));

beforeEach(() => {
  toasterShow.mockClear();
  promptOpen.mockReset();
});

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

describe('OutputTabs pages visibility notification', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('notifies when a newly added image format contains multiple pages', () => {
    const store = createDesignerStore();
    store.getState().addPage();
    const onPagesContentAdded = vi.fn();
    render(<OutputTabs store={store} onPagesContentAdded={onPagesContentAdded} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add custom size' }));

    expect(onPagesContentAdded).toHaveBeenCalledTimes(1);
  });

  it('does not notify for a single-page image format', () => {
    const store = createDesignerStore();
    const onPagesContentAdded = vi.fn();
    render(<OutputTabs store={store} onPagesContentAdded={onPagesContentAdded} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add custom size' }));

    expect(onPagesContentAdded).not.toHaveBeenCalled();
  });

  it('does not notify for a video format', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const onPagesContentAdded = vi.fn();
    render(<OutputTabs store={store} onPagesContentAdded={onPagesContentAdded} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add custom size' }));

    expect(onPagesContentAdded).not.toHaveBeenCalled();
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
    expect(screen.getByText('Frozen').className).toContain('bg-studioBorder/20');
    expect(screen.getByRole('button', { name: 'Add format' })).toHaveProperty('disabled', false);

    // Frozen must never borrow the selected accent: only the current format is highlighted.
    act(() => store.getState().setCurrentOutput(1));
    const frozenCard = document.querySelector('[data-output-index="0"]')!;
    const selectedCard = document.querySelector('[data-output-index="1"]')!;
    expect(frozenCard.className).not.toContain('border-designerAccent');
    expect(frozenCard.querySelector(':scope > button')!.className).not.toContain('bg-designerAccent/10');
    expect(selectedCard.className).toContain('border-designerAccent');
    expect(selectedCard.querySelector(':scope > button')!.className).toContain('bg-designerAccent/10');
    act(() => store.getState().setCurrentOutput(0));

    fireEvent.click(screen.getByRole('button', { name: 'Unfreeze format' }));
    expect(store.getState().doc.outputs[0].frozen).toBeUndefined();
    expect(screen.queryByText('Frozen')).toBeNull();
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

  it('clears already-applied selections when a later format is rejected', () => {
    const store = createDesignerStore();
    vi.spyOn(store.getState(), 'addOutput')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    const first = screen.getByRole('checkbox', { name: /Instagram Post 1080×1080/ });
    const second = screen.getByRole('checkbox', { name: /Instagram Story 1080×1920/ });
    fireEvent.click(first);
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 format' }));

    expect(first).toHaveProperty('checked', false);
    expect(second).toHaveProperty('checked', true);
    expect(screen.getByText('Add Formats')).toBeTruthy();
    expect(toasterShow).toHaveBeenCalledWith('Something went wrong', 'warning');
  });

  it('moves Link/Unlink into the targeted card menu without rewriting element links', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Linked',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    const origins = store.getState().doc.outputs.map((out: any) => out.children[0].originId);
    const historyIndex = store.getState().historyIndex;
    render(<OutputTabs store={store} />);

    expect(screen.queryByRole('button', { name: 'Unlink edits between formats' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Format actions for X' }));
    fireEvent.click(screen.getByRole('button', { name: /Unlink edits between formats/ }));
    expect(store.getState().currentOutput).toBe(1);
    expect(store.getState().editFormatOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Resume linked editing' })).toBeTruthy();
    expect(store.getState().historyIndex).toBe(historyIndex);
    expect(store.getState().doc.outputs.map((out: any) => out.children[0].originId)).toEqual(origins);

    fireEvent.click(document.querySelector('[data-format-select]')!);
    expect(store.getState().currentOutput).toBe(0);
    expect(store.getState().editFormatOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Resume linked editing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Instagram Post' }));
    expect(screen.getByRole('button', { name: /Link edits across formats/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume linked editing' }));
    expect(store.getState().editFormatOnly).toBe(false);
    expect(screen.queryByRole('button', { name: 'Resume linked editing' })).toBeNull();
    expect(store.getState().doc.outputs.map((out: any) => out.children[0].originId)).toEqual(origins);
  });
});

describe('OutputTabs duplication actions', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('duplicates a page-bearing format from its actions menu and reopens Pages', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', text: 'Linked', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addPage();
    const onPagesContentAdded = vi.fn();
    const historyLength = store.getState().history.length;
    render(<OutputTabs store={store} onPagesContentAdded={onPagesContentAdded} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Instagram Post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate linked' }));

    expect(store.getState().doc.outputs).toHaveLength(2);
    expect(store.getState().currentOutput).toBe(1);
    expect(store.getState().doc.outputs[1].children[0].originId)
      .toBe(store.getState().doc.outputs[0].children[0].originId);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(onPagesContentAdded).toHaveBeenCalledTimes(1);
    act(() => store.getState().undo());
    expect(store.getState().doc.outputs).toHaveLength(1);
  });

  it('duplicates a video format independently from right-click without reflow', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const track = store.getState().doc.outputs[0].tracks[0];
    store.getState().addClip(0, track.id, {
      id: 'clip', startMs: 100, endMs: 2000, src: '/movie.mp4', x: 12, y: 24, width: 320, height: 180,
    } as never);
    const historyLength = store.getState().history.length;
    render(<OutputTabs store={store} />);

    fireEvent.contextMenu(document.querySelector('[data-output-index="0"]')!, {
      clientX: 30, clientY: 40,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate independently' }));

    const outputs = store.getState().doc.outputs;
    expect(outputs).toHaveLength(2);
    const sourceClip = outputs[0].tracks[0].clips[0];
    const copyClip = outputs[1].tracks[0].clips[0];
    expect(copyClip).toMatchObject({ x: 12, y: 24, width: 320, height: 180, startMs: 100, endMs: 2000 });
    expect(copyClip.id).not.toBe(sourceClip.id);
    expect(copyClip.originId).toBeUndefined();
    expect(store.getState().history).toHaveLength(historyLength + 1);
  });

  it('warns when duplication is refused for a frozen source', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Unlinked',
    });
    store.getState().updateElement('headline', { originId: undefined });
    store.getState().setOutputFrozen(0, true);
    toasterShow.mockClear();
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Instagram Post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate linked' }));

    expect(toasterShow).toHaveBeenCalledWith('This format is frozen. Unfreeze it to edit.', 'warning');
    expect(store.getState().doc.outputs).toHaveLength(1);
  });

  it('opens the existing resize popover from the format action menu', () => {
    const store = createDesignerStore();
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Instagram Post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resize / change format' }));

    expect(screen.getByText('Resize Format')).toBeTruthy();
  });
});


describe('OutputTabs safe format actions', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const card = (store: ReturnType<typeof createDesignerStore>, index: number) => {
    const id = store.getState().doc.outputs[index].id;
    const element = document.querySelector(`[data-format-card="${id}"]`);
    if (!element) throw new Error(`Missing format card ${id}`);
    return element as HTMLElement;
  };

  it('uses a default custom name and renames through the card prompt', async () => {
    const store = createDesignerStore();
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add format' }));
    fireEvent.change(screen.getByPlaceholderText('W'), { target: { value: '1920' } });
    fireEvent.change(screen.getByPlaceholderText('H'), { target: { value: '1080' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add custom size' }));

    expect(store.getState().doc.outputs[1]).toMatchObject({
      name: 'Custom size', width: 1920, height: 1080,
    });
    expect(screen.getByText('Custom size')).toBeTruthy();
    expect(screen.getByText('1920×1080')).toBeTruthy();
    expect(screen.queryByText('1920×1080 1920×1080')).toBeNull();

    promptOpen.mockResolvedValue('Landscape campaign');
    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Custom size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename format' }));

    await waitFor(() => expect(store.getState().doc.outputs[1].name).toBe('Landscape campaign'));
    expect(promptOpen).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Rename format', label: 'Format name', initialValue: 'Custom size',
    }));
    expect(store.getState().historyLabels.at(-1)).toBe('Rename format');
  });

  it('does not rename when the prompt is cancelled', async () => {
    const store = createDesignerStore();
    const before = store.getState().doc;
    const historyIndex = store.getState().historyIndex;
    promptOpen.mockResolvedValue(null);
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Instagram Post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename format' }));

    await waitFor(() => expect(promptOpen).toHaveBeenCalled());
    expect(store.getState().doc).toBe(before);
    expect(store.getState().historyIndex).toBe(historyIndex);
  });

  it('keeps resize anchored to the intended non-active card', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for X' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resize / change format' }));
    fireEvent.change(screen.getByPlaceholderText('W'), { target: { value: '800' } });
    fireEvent.change(screen.getByPlaceholderText('H'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(store.getState().doc.outputs[0]).toMatchObject({ width: 1080, height: 1080 });
    expect(store.getState().doc.outputs[1]).toMatchObject({
      formatId: 'custom', name: 'Custom size', width: 800, height: 600,
    });
  });

  it('shows Remove for selection or hover and restores the same format with Undo', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    render(<OutputTabs store={store} />);

    expect(within(card(store, 0)).getByRole('button', { name: 'Remove format' }).className).toContain('visible');
    expect(within(card(store, 1)).getByRole('button', { name: 'Remove format' }).className).toContain('invisible');
    expect(within(card(store, 1)).getByRole('button', { name: 'Remove format' }).className).toContain('group-hover:visible');

    fireEvent.mouseOver(card(store, 1));
    fireEvent.click(within(card(store, 1)).getByRole('button', { name: 'Remove format' }));
    expect(store.getState().doc.outputs).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toContain('Format “X” removed');

    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(store.getState().doc.outputs).toHaveLength(2);
    expect(store.getState().doc.outputs[1]).toMatchObject({ formatId: 'x-post', name: 'X' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('invalidates the removal Undo after a later edit instead of reverting it', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    render(<OutputTabs store={store} />);

    fireEvent.click(within(card(store, 1)).getByRole('button', { name: 'Remove format' }));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      store.getState().addOutput({ formatId: 'custom', name: 'Later edit', width: 800, height: 600 });
    });

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo', exact: true })).toBeNull();
    expect(store.getState().doc.outputs.map((output) => output.name)).toEqual([
      'Instagram Post', 'Later edit',
    ]);
  });
});


describe('OutputTabs rename identity', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renames by output id when collaboration reorders outputs while the prompt is open', async () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    const targetId = store.getState().doc.outputs[1].id;
    const otherId = store.getState().doc.outputs[0].id;
    let resolvePrompt!: (value: string | null) => void;
    const pendingName = new Promise<string | null>((resolve) => {
      resolvePrompt = resolve;
    });
    promptOpen.mockReturnValue(pendingName);
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for X' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename format' }));
    await waitFor(() => expect(promptOpen).toHaveBeenCalled());

    act(() => {
      const doc = store.getState().doc;
      store.getState().replaceDocTrusted({
        ...doc,
        outputs: [doc.outputs[1], doc.outputs[0]],
      });
    });
    await act(async () => {
      resolvePrompt('Renamed X');
      await pendingName;
    });

    await waitFor(() => {
      expect(store.getState().doc.outputs.find((output) => output.id === targetId)?.name)
        .toBe('Renamed X');
    });
    expect(store.getState().doc.outputs.find((output) => output.id === otherId)?.name)
      .toBe('Instagram Post');
  });
});


describe('OutputTabs follow-up regressions', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('turns linking back on from a non-current card menu', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Linked',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    store.getState().setEditFormatOnly(true);
    const origins = store.getState().doc.outputs.map((output: any) => output.children[0].originId);
    const historyIndex = store.getState().historyIndex;
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Format actions for X' }));
    fireEvent.click(screen.getByRole('button', { name: /Link edits across formats/ }));

    expect(store.getState().currentOutput).toBe(1);
    expect(store.getState().editFormatOnly).toBe(false);
    expect(screen.queryByRole('button', { name: 'Resume linked editing' })).toBeNull();
    expect(store.getState().historyIndex).toBe(historyIndex);
    expect(store.getState().doc.outputs.map((output: any) => output.children[0].originId)).toEqual(origins);
  });

  it('keeps Remove Undo available when a save adopts a materialized document', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    render(<OutputTabs store={store} />);
    const outputId = store.getState().doc.outputs[1].id;
    const card = document.querySelector(`[data-format-card="${outputId}"]`) as HTMLElement;

    fireEvent.click(within(card).getByRole('button', { name: 'Remove format' }));
    const sentDoc = store.getState().doc;
    const removalHistory = store.getState().history;
    const persistedDoc = {
      ...sentDoc,
      outputs: sentDoc.outputs.map((output) => ({ ...output })),
    };
    act(() => {
      expect(store.getState().adoptPersistedDoc(sentDoc, persistedDoc)).toBe(true);
    });

    expect(store.getState().doc).not.toBe(sentDoc);
    expect(store.getState().history).toBe(removalHistory);
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(store.getState().doc.outputs).toHaveLength(2);
    expect(store.getState().doc.outputs[1].name).toBe('X');
  });

  it('invalidates Remove Undo for a silent edit before a history commit', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Linked',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    render(<OutputTabs store={store} />);
    const outputId = store.getState().doc.outputs[1].id;
    const card = document.querySelector(`[data-format-card="${outputId}"]`) as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Remove format' }));
    const removalHistoryIndex = store.getState().historyIndex;

    act(() => {
      expect(store.getState().updateElementEphemeral('headline', { x: 25 })).toBe(true);
    });

    expect(store.getState().historyIndex).toBe(removalHistoryIndex);
    expect(store.getState().doc).not.toBe(store.getState().history[removalHistoryIndex]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});


describe('OutputTabs capped removal history', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('invalidates Remove Undo when a later edit reuses index 49 at the history cap', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'headline', type: 'text', x: 0, y: 0, width: 200, height: 40,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Linked',
    });
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setCurrentOutput(0);
    for (let index = 0; store.getState().history.length < 50; index++) {
      store.getState().updateElement('headline', { x: index + 1 });
      store.getState().pushHistory('Move');
    }
    expect(store.getState().history).toHaveLength(50);
    expect(store.getState().historyIndex).toBe(49);
    store.getState().setCurrentOutput(1);
    render(<OutputTabs store={store} />);
    const outputId = store.getState().doc.outputs[1].id;
    const card = document.querySelector(`[data-format-card="${outputId}"]`) as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Remove format' }));
    const removalHistory = store.getState().history;
    expect(store.getState().historyIndex).toBe(49);
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => {
      store.getState().updateElement('headline', { x: 999 });
      store.getState().pushHistory('Move');
    });

    expect(store.getState().history).toHaveLength(50);
    expect(store.getState().historyIndex).toBe(49);
    expect(store.getState().history).not.toBe(removalHistory);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo', exact: true })).toBeNull();
    expect(store.getState().doc.outputs).toHaveLength(1);
    expect((store.getState().doc.outputs[0] as any).children[0].x).toBe(999);
  });
});

describe('OutputTabs menu guards', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('disables Resize, Rename, and Remove for a frozen format', () => {
    const store = createDesignerStore();
    store.getState().addOutput({ formatId: 'x-post', name: 'X', width: 1200, height: 675 });
    store.getState().setOutputFrozen(0, true);
    render(<OutputTabs store={store} />);

    const frozenCard = document.querySelector<HTMLElement>('[data-output-index="0"]')!;
    expect(within(frozenCard).getByRole('button', { name: 'Remove format' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Format actions for Instagram Post' }));
    expect(screen.getByRole('button', { name: 'Resize / change format' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Rename format' })).toHaveProperty('disabled', true);
    // Duplicating a frozen format is still allowed: it creates an editable copy.
    expect(screen.getByRole('button', { name: 'Duplicate linked' })).toHaveProperty('disabled', false);
  });

  it('disables both duplication choices at the format limit', () => {
    const store = createDesignerStore();
    const source = store.getState().doc.outputs[0];
    store.getState().replaceDocTrusted({
      ...store.getState().doc,
      outputs: Array.from({ length: MAX_OUTPUTS }, (_, index) => ({ ...source, id: `output-${index}` })),
    });
    render(<OutputTabs store={store} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Format actions for Instagram Post' })[0]);
    expect(screen.getByRole('button', { name: 'Duplicate linked' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Duplicate independently' })).toHaveProperty('disabled', true);
  });
});
