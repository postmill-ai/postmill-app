import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  addSmartFilter,
  bakeDimensions,
  bakeSource,
  flattenSmartFilters,
  removeSmartFilter,
  reorderSmartFilter,
  toggleSmartFilter,
  updateSmartFilterParams,
} from './smart-filters';
import { SmartFilterList } from './panels/smart-filter-list';
import { createDesignerStore, type DesignerElement } from './designer.store';
import { MAX_SMART_FILTERS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';

/**
 * The non-destructive filter stack.
 *
 * The stack is a RECIPE, not pixels — the ordering and enable rules here are
 * the whole feature, because the bake that follows just replays them.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

afterEach(cleanup);

describe('addSmartFilter', () => {
  it('appends, so the newest filter runs last', () => {
    const stack = addSmartFilter(addSmartFilter(undefined, 'blur', { radius: 4 }), 'sharpen', {});
    expect(stack.map((f) => f.id)).toEqual(['blur', 'sharpen']);
    expect(stack[0].params).toEqual({ radius: 4 });
  });

  it('allows the same filter twice — two blurs is a legitimate recipe', () => {
    const stack = addSmartFilter(addSmartFilter(undefined, 'blur', { radius: 2 }), 'blur', { radius: 8 });
    expect(stack).toHaveLength(2);
  });

  it('stops at the cap rather than growing without bound', () => {
    let stack = addSmartFilter(undefined, 'blur', {});
    for (let i = 0; i < MAX_SMART_FILTERS + 5; i++) stack = addSmartFilter(stack, 'blur', {});
    expect(stack).toHaveLength(MAX_SMART_FILTERS);
  });
});

describe('toggleSmartFilter', () => {
  it('turns an entry off without discarding its settings', () => {
    const stack = toggleSmartFilter([{ id: 'blur', params: { radius: 9 } }], 0);
    expect(stack[0].enabled).toBe(false);
    expect(stack[0].params).toEqual({ radius: 9 });
  });

  it('turns it back on', () => {
    expect(toggleSmartFilter([{ id: 'blur', enabled: false }], 0)[0].enabled).toBe(true);
  });

  it('leaves its neighbours alone', () => {
    const stack = toggleSmartFilter([{ id: 'a' }, { id: 'b' }], 1);
    expect(stack[0].enabled).toBeUndefined();
  });
});

describe('reorderSmartFilter', () => {
  const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moves an entry up', () => {
    expect(reorderSmartFilter(three, 2, 1).map((f) => f.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves an entry down', () => {
    expect(reorderSmartFilter(three, 0, 2).map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });

  it('clamps rather than dropping the entry off the end', () => {
    expect(reorderSmartFilter(three, 0, -5).map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(reorderSmartFilter(three, 0, 99).map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });

  it('ignores an index that is not in the stack', () => {
    expect(reorderSmartFilter(three, 7, 0).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the stack it was given', () => {
    const original = [...three];
    reorderSmartFilter(three, 0, 2);
    expect(three).toEqual(original);
  });
});

describe('removeSmartFilter / updateSmartFilterParams', () => {
  it('removes exactly one entry', () => {
    expect(removeSmartFilter([{ id: 'a' }, { id: 'b' }], 0).map((f) => f.id)).toEqual(['b']);
  });

  it('retunes one entry and leaves the rest', () => {
    const stack = updateSmartFilterParams(
      [{ id: 'a', params: { radius: 1 } }, { id: 'b', params: { radius: 2 } }],
      1,
      { radius: 40 }
    );
    expect(stack[0].params).toEqual({ radius: 1 });
    expect(stack[1].params).toEqual({ radius: 40 });
  });
});

describe('bakeSource', () => {
  it('reads the ORIGINAL, never the already-baked bitmap', () => {
    // Re-baking from `src` compounds the effect on every parameter tweak — the
    // single trap this whole design exists to avoid.
    expect(bakeSource({ originalSrc: 'https://x/original.png', src: 'https://x/baked.png' }))
      .toBe('https://x/original.png');
  });

  it('falls back to src for the very first bake', () => {
    expect(bakeSource({ src: 'https://x/a.png' })).toBe('https://x/a.png');
  });

  it('has nothing to read when the layer has no pixels', () => {
    expect(bakeSource({})).toBeUndefined();
  });
});

describe('bakeDimensions', () => {
  it('bakes at the source resolution, not the element box', () => {
    // The regression: baking into the box stretched the source to fit, so
    // adding any filter to a cover-fit photo whose aspect differed from its
    // frame silently squashed it. A stack is a pixel operation, never a
    // geometry one — and the server renderer evaluates the same recipe at
    // source resolution, so anything else renders one document two ways.
    expect(bakeDimensions({ naturalWidth: 4000, naturalHeight: 1000 })).toEqual({
      width: 4000,
      height: 1000,
    });
  });

  it('falls back to width/height when natural dimensions are unavailable', () => {
    expect(bakeDimensions({ width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
  });

  it('rounds and never returns a zero-sized canvas', () => {
    expect(bakeDimensions({ naturalWidth: 10.4, naturalHeight: 0 })).toEqual({
      width: 10,
      height: 1,
    });
  });
});

describe('flattenSmartFilters', () => {
  it('drops the recipe AND the original — flattening is one-way', () => {
    // Keeping `originalSrc` would leave a second full-size upload attached to
    // a layer that can no longer use it.
    expect(flattenSmartFilters()).toEqual({
      smartFilters: undefined,
      originalSrc: undefined,
      originalFileId: undefined,
    });
  });
});

describe('SmartFilterList', () => {
  const withStack = (smartFilters: DesignerElement['smartFilters']) => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: '',
      type: 'image',
      x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
      src: 'https://x/a.png',
      originalSrc: 'https://x/original.png',
      smartFilters,
    } as DesignerElement);
    const el = store.getState().doc.outputs[0].children[0] as DesignerElement;
    return { store, el };
  };

  const stackOf = (store: ReturnType<typeof createDesignerStore>) =>
    (store.getState().doc.outputs[0].children[0] as DesignerElement).smartFilters;

  /** The list is now stack-shaped, so it serves layers and clips alike. */
  const list = (store: ReturnType<typeof createDesignerStore>, el: DesignerElement) => (
    <SmartFilterList
      stack={(store.getState().doc.outputs[0].children[0] as DesignerElement).smartFilters}
      onChange={(next) => {
        store.getState().updateElement(el.id, { smartFilters: next });
        store.getState().pushHistory();
      }}
    />
  );

  it('renders nothing for a layer with no stack', () => {
    const { store, el } = withStack(undefined);
    const { container } = render(list(store, el));
    expect(container.firstChild).toBeNull();
  });

  it('lists each filter by its human name', () => {
    const { store, el } = withStack([{ id: 'gaussian-blur' }, { id: 'sharpen' }]);
    render(list(store, el));
    expect(screen.getByText('Gaussian Blur')).toBeTruthy();
    expect(screen.getByText('Sharpen')).toBeTruthy();
  });

  it('falls back to the id for a filter it does not recognise', () => {
    const { store, el } = withStack([{ id: 'not-a-filter' }]);
    render(list(store, el));
    expect(screen.getByText('not-a-filter')).toBeTruthy();
  });

  it('toggles an entry off through the store', () => {
    const { store, el } = withStack([{ id: 'gaussian-blur' }]);
    render(list(store, el));

    fireEvent.click(screen.getByRole('button', { name: 'Disable filter' }));
    expect(stackOf(store)![0].enabled).toBe(false);
  });

  it('reorders through the store', () => {
    const { store, el } = withStack([{ id: 'gaussian-blur' }, { id: 'sharpen' }]);
    render(list(store, el));

    fireEvent.click(screen.getAllByRole('button', { name: 'Move filter up' })[1]);
    expect(stackOf(store)!.map((f) => f.id)).toEqual(['sharpen', 'gaussian-blur']);
  });

  it('cannot move the first entry up or the last one down', () => {
    const { store, el } = withStack([{ id: 'gaussian-blur' }, { id: 'sharpen' }]);
    render(list(store, el));

    const up = screen.getAllByRole('button', { name: 'Move filter up' });
    const down = screen.getAllByRole('button', { name: 'Move filter down' });
    expect((up[0] as HTMLButtonElement).disabled).toBe(true);
    expect((down[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('removes through the store', () => {
    const { store, el } = withStack([{ id: 'gaussian-blur' }, { id: 'sharpen' }]);
    render(list(store, el));

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove filter' })[0]);
    expect(stackOf(store)!.map((f) => f.id)).toEqual(['sharpen']);
  });
});
