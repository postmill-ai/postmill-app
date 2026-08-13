import { renderHook, act } from '@testing-library/react';
import { useFloatingPanelState } from './use-floating-panel-state';

const DEFAULTS = { x: 72, y: 16, height: 360, open: false };

describe('useFloatingPanelState', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the defaults when nothing is stored', () => {
    const { result } = renderHook(() =>
      useFloatingPanelState('layers', 'org-1', DEFAULTS)
    );
    expect(result.current.state).toEqual(DEFAULTS);
  });

  it('persists position and open state under an org-scoped key', () => {
    const { result } = renderHook(() =>
      useFloatingPanelState('layers', 'org-1', DEFAULTS)
    );
    act(() => result.current.setPosition({ x: 300, y: 120, height: 400 }));
    act(() => result.current.setOpen(true));

    const raw = localStorage.getItem('designer-layers-panel-org-1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ x: 300, y: 120, height: 400, open: true });
  });

  it('restores a stored value on mount', () => {
    localStorage.setItem(
      'designer-layers-panel-org-1',
      JSON.stringify({ x: 500, y: 40, height: 220, open: true })
    );
    const { result } = renderHook(() =>
      useFloatingPanelState('layers', 'org-1', DEFAULTS)
    );
    expect(result.current.state).toEqual({ x: 500, y: 40, height: 220, open: true });
  });

  it('keeps orgs separate', () => {
    localStorage.setItem(
      'designer-layers-panel-org-1',
      JSON.stringify({ x: 500, y: 40, height: 220, open: true })
    );
    const { result } = renderHook(() =>
      useFloatingPanelState('layers', 'org-2', DEFAULTS)
    );
    expect(result.current.state).toEqual(DEFAULTS);
  });

  it('falls back to defaults on malformed or partial stored values', () => {
    // A hand-edited or stale entry must never strand the panel off-screen.
    for (const bad of ['not json', '{}', '{"x":1}', 'null', '{"x":"a","y":2,"height":3}']) {
      localStorage.setItem('designer-layers-panel-org-1', bad);
      const { result } = renderHook(() =>
        useFloatingPanelState('layers', 'org-1', DEFAULTS)
      );
      expect(result.current.state).toEqual(DEFAULTS);
    }
  });

  it('toggles open without disturbing the position', () => {
    const { result } = renderHook(() =>
      useFloatingPanelState('layers', 'org-1', DEFAULTS)
    );
    act(() => result.current.setPosition({ x: 200, y: 60, height: 300 }));
    act(() => result.current.toggle());
    expect(result.current.state).toEqual({ x: 200, y: 60, height: 300, open: true });
    act(() => result.current.toggle());
    expect(result.current.state).toEqual({ x: 200, y: 60, height: 300, open: false });
  });
});
