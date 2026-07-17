import { describe, it, expect, beforeEach } from 'vitest';
import { useLaunchStore } from './store';

const integration = (id: string) =>
  ({ id, name: `Channel ${id}`, identifier: 'twitter' } as any);

const resetStore = () => {
  useLaunchStore.getState().reset();
};

describe('useLaunchStore', () => {
  beforeEach(() => resetStore());

  describe('addOrRemoveSelectedIntegration (0.12 null guard)', () => {
    it('does not throw when passed an undefined integration', () => {
      expect(() =>
        useLaunchStore.getState().addOrRemoveSelectedIntegration(
          undefined as any,
          {}
        )
      ).not.toThrow();
    });

    it('selects, then deselects, clearing matching internal entries (4.5d)', () => {
      const store = useLaunchStore;
      const int = integration('a');

      store.getState().addOrRemoveSelectedIntegration(int, { foo: 1 });
      expect(store.getState().selectedIntegrations).toHaveLength(1);

      // Switch channel A to internal (per-channel) mode.
      store.getState().addRemoveInternal('a');
      expect(
        store.getState().internal.some((i) => i.integration.id === 'a')
      ).toBe(true);

      // Deselecting the channel must also drop its stale internal customization.
      store.getState().addOrRemoveSelectedIntegration(int, {});
      expect(store.getState().selectedIntegrations).toHaveLength(0);
      expect(
        store.getState().internal.some((i) => i.integration.id === 'a')
      ).toBe(false);
    });
  });

  describe('addRemoveInternal (4.5d guard)', () => {
    it('is a no-op when the integration is not selected', () => {
      const store = useLaunchStore;
      const before = store.getState().internal;
      expect(() => store.getState().addRemoveInternal('missing')).not.toThrow();
      expect(store.getState().internal).toEqual(before);
    });
  });

  describe('deleteGlobalValue (4.5g documented id-reuse)', () => {
    it('keeps ids pinned to slot position while content shifts up', () => {
      const store = useLaunchStore;
      store.getState().setGlobalValue([
        { id: 'id-1', content: 'A', delay: 0, media: [] },
        { id: 'id-2', content: 'B', delay: 0, media: [] },
        { id: 'id-3', content: 'C', delay: 0, media: [] },
      ]);

      store.getState().deleteGlobalValue(1); // delete middle (B)

      const global = store.getState().global;
      expect(global.map((g) => g.id)).toEqual(['id-1', 'id-2']);
      // Content shifted up onto the surviving ids — the deliberate behavior.
      expect(global.map((g) => g.content)).toEqual(['A', 'C']);
    });
  });
});
