import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollaboration } from './collaboration';
import type { DesignerDoc } from './designer.store';

// Minimal WebSocket mock that records instances and sent payloads.
class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1;
  readyState = 1;
  binaryType = '';
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    MockWS.instances.push(this);
  }
  send(data: any) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const imageDoc: DesignerDoc = {
  version: 2,
  mode: 'image',
  outputs: [] as any,
} as any;

describe('useCollaboration (4.4)', () => {
  beforeEach(() => {
    MockWS.instances = [];
    (globalThis as any).WebSocket = MockWS as any;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not tear down / rebuild the socket when the parent re-renders with the same callbacks', () => {
    const cbs = {
      onRemoteDoc: vi.fn(),
      onConnectedChange: vi.fn(),
      onPeerTimeline: vi.fn(),
      onPeerImage: vi.fn(),
    };
    const { rerender } = renderHook(
      (props: any) =>
        useCollaboration({
          designId: 'd1',
          enabled: true,
          ...cbs,
          ...props,
        }),
      { initialProps: {} },
    );
    expect(MockWS.instances.length).toBe(1);
    // Re-render several times with the SAME (stable) callback identities.
    rerender({});
    rerender({});
    rerender({});
    // No new socket constructed → the effect did not re-run.
    expect(MockWS.instances.length).toBe(1);
  });

  it('broadcasts an incremental delta on a local edit (not before the socket opens)', () => {
    const { result } = renderHook(() =>
      useCollaboration({
        designId: 'd1',
        enabled: true,
        onRemoteDoc: vi.fn(),
        onConnectedChange: vi.fn(),
        onPeerTimeline: vi.fn(),
        onPeerImage: vi.fn(),
      }),
    );
    const ws = MockWS.instances[0];
    // Open the socket (fires the one full-state catch-up send).
    act(() => ws.onopen?.());
    const afterOpen = ws.sent.length;

    // A local edit → the update observer forwards a delta.
    act(() => result.current.sendUpdate({ ...imageDoc } as DesignerDoc));
    expect(ws.sent.length).toBeGreaterThan(afterOpen);
    const delta = ws.sent[ws.sent.length - 1];
    expect(delta).toBeInstanceOf(Uint8Array);
  });
});
