import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore } from './designer.store';
import { runGestureCommit } from './gesture-lifecycle';

describe('runGestureCommit', () => {
  it('releases the gesture when asynchronous commit work rejects', async () => {
    const store = createDesignerStore();
    const onEnd = vi.fn();
    store.getState().beginGesture();

    await expect(runGestureCommit(store, async () => {
      await Promise.resolve();
      throw new Error('cleanup failed');
    }, onEnd)).rejects.toThrow('cleanup failed');

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('releases the gesture when the single history commit throws', async () => {
    const store = createDesignerStore();
    const pushHistory = vi.fn(() => {
      throw new Error('history failed');
    });
    store.setState({ pushHistory });
    store.getState().beginGesture();

    await expect(runGestureCommit(store, async () => {
      store.getState().pushHistory('Edit geometry');
    })).rejects.toThrow('history failed');

    expect(pushHistory).toHaveBeenCalledTimes(1);
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('ends after one successful history commit', async () => {
    const store = createDesignerStore();
    const depth = store.getState().history.length;
    store.getState().beginGesture();

    await runGestureCommit(store, async () => {
      store.getState().pushHistory('Edit geometry');
    });

    expect(store.getState().history).toHaveLength(depth + 1);
    expect(store.getState().gestureDepth).toBe(0);
  });
});
