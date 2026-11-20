import { describe, expect, it } from 'vitest';
import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { measureMenuSize, type MenuPlacement } from './context-menu-position';
import { useBoundedMenuPlacement } from './use-bounded-menu-placement';

// jsdom has no layout, so each view's box metrics are stubbed. `content` is the
// scroll size; every menu has a 1px border on each side (2px per axis).
interface Box { width: number; height: number }
const BORDER = 2;

function stubBox(element: HTMLElement, content: Box) {
  element.getBoundingClientRect = () => ({
    width: content.width + BORDER, height: content.height + BORDER,
    left: 0, top: 0, right: content.width + BORDER, bottom: content.height + BORDER, x: 0, y: 0,
    toJSON: () => ({}),
  });
  for (const [key, value] of Object.entries({
    clientWidth: content.width, clientHeight: content.height,
    scrollWidth: content.width, scrollHeight: content.height,
  })) {
    Object.defineProperty(element, key, { configurable: true, get: () => value });
  }
}

function Harness({ point, view, boxFor, seen }: {
  point: { x: number; y: number } | null;
  view: string;
  boxFor: (view: string) => Box;
  seen: Array<{ view: string; placement: MenuPlacement | null }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const placement = useBoundedMenuPlacement(ref, point, view);
  seen.push({ view, placement });
  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (element) stubBox(element, boxFor(view));
      }}
    />
  );
}

describe('measureMenuSize', () => {
  it('adds the border back to the scroll size', () => {
    const element = document.createElement('div');
    stubBox(element, { width: 180, height: 625 });
    expect(measureMenuSize(element)).toEqual({ width: 182, height: 627 });
  });

  it('never shrinks below a previous measurement', () => {
    const element = document.createElement('div');
    stubBox(element, { width: 158, height: 300 });
    expect(measureMenuSize(element, { width: 182, height: 627 })).toEqual({ width: 182, height: 627 });
  });
});

describe('useBoundedMenuPlacement', () => {
  const point = { x: 100, y: 100 };

  it('caps a menu that fits at its border box, so its content does not scroll', () => {
    const seen: Array<{ view: string; placement: MenuPlacement | null }> = [];
    render(<Harness point={point} view="main" boxFor={() => ({ width: 180, height: 625 })} seen={seen} />);

    const placement = seen.at(-1)!.placement!;
    // max-height applies to the border box: 625 content + 2 border. With that cap
    // clientHeight (625) equals scrollHeight (625), so no scrollbar appears.
    expect(placement.maxHeight).toBe(627);
    expect(placement.maxWidth).toBe(182);
    expect(placement.scrollable).toBe(false);
  });

  it('measures each view uncapped and restores the first-open size after Back', () => {
    const seen: Array<{ view: string; placement: MenuPlacement | null }> = [];
    let mainBox = { width: 180, height: 625 };
    const boxFor = (view: string) => (view === 'main' ? mainBox : { width: 150, height: 200 });
    const { rerender } = render(<Harness point={point} view="main" boxFor={boxFor} seen={seen} />);
    expect(seen.at(-1)!.placement!.maxWidth).toBe(182);

    seen.length = 0;
    rerender(<Harness point={point} view="upscale" boxFor={boxFor} seen={seen} />);
    // The sub-menu first renders without the main view's caps, then gets its own.
    expect(seen[0]).toEqual({ view: 'upscale', placement: null });
    expect(seen.at(-1)!.placement!.maxWidth).toBe(152);

    // Even if the main view reports a narrower box after Back (a leftover cap),
    // it returns to the width it first opened with.
    mainBox = { width: 158, height: 625 };
    rerender(<Harness point={point} view="main" boxFor={boxFor} seen={seen} />);
    expect(seen.at(-1)!.placement!.maxWidth).toBe(182);
  });

  it('forgets remembered sizes when the menu reopens', () => {
    const seen: Array<{ view: string; placement: MenuPlacement | null }> = [];
    let mainBox = { width: 180, height: 625 };
    const boxFor = () => mainBox;
    const { rerender } = render(<Harness point={point} view="main" boxFor={boxFor} seen={seen} />);
    mainBox = { width: 120, height: 100 };
    rerender(<Harness point={{ x: 100, y: 100 }} view="main" boxFor={boxFor} seen={seen} />);
    expect(seen.at(-1)!.placement!.maxWidth).toBe(122);
    expect(seen.at(-1)!.placement!.maxHeight).toBe(102);
  });
});
