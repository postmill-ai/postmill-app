import React, { FC } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FullscreenButton } from './fullscreen-button';
import { useFullscreenSurface } from './use-fullscreen';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const COLLAPSED = 'rounded-[12px] overflow-hidden';

/** Stands in for a studio root: the class hook plus the toggle that drives it. */
const Studio: FC = () => {
  const surface = useFullscreenSurface(COLLAPSED);
  return (
    <div data-testid="root" className={`flex flex-col h-full bg-studioBg ${surface}`}>
      <FullscreenButton />
      <input data-testid="field" />
    </div>
  );
};

const root = () => screen.getByTestId('root');
const toggle = () => screen.getByRole('button');
const esc = (target: Document | HTMLElement = document) =>
  fireEvent.keyDown(target, { key: 'Escape' });

// RTL unmounts between tests, and the surface hook resets the shared store on
// unmount — so each test starts collapsed without reaching into the store.
afterEach(cleanup);

describe('full screen', () => {
  it('starts collapsed', () => {
    render(<Studio />);
    expect(root().className).toContain(COLLAPSED);
    expect(root().className).not.toContain('fixed inset-0');
    expect(toggle().getAttribute('aria-label')).toBe('Enter full screen');
  });

  it('expands to cover the viewport, under the modal layer', () => {
    render(<Studio />);
    fireEvent.click(toggle());

    // z-100 is deliberate: modals mount at 200+ and must stay above.
    expect(root().className).toContain('fixed inset-0 z-[100]');
    expect(root().className).not.toContain(COLLAPSED);
    // The base classes survive the swap.
    expect(root().className).toContain('bg-studioBg');
    expect(toggle().getAttribute('aria-label')).toBe('Exit full screen');
  });

  it('collapses again on a second click', () => {
    render(<Studio />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(root().className).toContain(COLLAPSED);
    expect(root().className).not.toContain('fixed inset-0');
  });

  it('renders whatever the browser supports — there is no API to feature-detect', () => {
    // It used to hide itself when the Fullscreen API was unavailable, which made
    // the button silently absent in blocked contexts.
    render(<Studio />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('collapses on Escape', () => {
    render(<Studio />);
    fireEvent.click(toggle());

    esc();

    expect(root().className).toContain(COLLAPSED);
  });

  it('leaves Escape alone while a modal is open', () => {
    // The modal owns Escape; collapsing the studio underneath it would be wrong.
    render(
      <>
        <Studio />
        <div role="dialog" aria-modal="true" />
      </>
    );
    fireEvent.click(toggle());

    esc();

    expect(root().className).toContain('fixed inset-0');
  });

  it('leaves Escape alone while typing', () => {
    // The Designer and Replicate command palettes autofocus an input and close
    // on Escape; so do inline text editing and layer rename.
    render(<Studio />);
    fireEvent.click(toggle());

    esc(screen.getByTestId('field'));

    expect(root().className).toContain('fixed inset-0');
  });

  it('ignores an Escape another handler already claimed', () => {
    render(<Studio />);
    fireEvent.click(toggle());

    // `window` sits before `document` in the capture path, so this stands in for
    // any handler that gets there first and calls preventDefault().
    const claim = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', claim, true);
    try {
      esc();
    } finally {
      window.removeEventListener('keydown', claim, true);
    }

    expect(root().className).toContain('fixed inset-0');
  });

  it('does not react to other keys', () => {
    render(<Studio />);
    fireEvent.click(toggle());

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(root().className).toContain('fixed inset-0');
  });

  it('resets when the studio unmounts, so the next page is not left expanded', () => {
    const first = render(<Studio />);
    fireEvent.click(toggle());
    expect(root().className).toContain('fixed inset-0');

    first.unmount();
    render(<Studio />);

    expect(root().className).toContain(COLLAPSED);
  });

  it('keeps every surface in step — the button and the root are separate consumers', () => {
    // They used to agree only because both read document.fullscreenElement;
    // without a shared store they would silently diverge.
    render(<Studio />);
    fireEvent.click(toggle());
    expect(root().className).toContain('fixed inset-0');
    expect(toggle().getAttribute('aria-label')).toBe('Exit full screen');
  });
});
