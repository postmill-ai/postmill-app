import { describe, it, expect } from 'vitest';
import { createDesignerStore } from './designer.store';

/**
 * Lightweight performance benchmark for the designer store.
 *
 * Creates a 50-element image document with filters, simulates a drag update
 * across all elements, and switches output tabs. Assertions use generous
 * budgets so the test stays green on slower CI runners while still catching
 * serious regressions.
 */
describe('designer performance', () => {
  it('drags and switches tabs on a 50-element filtered doc within budget', () => {
    const store = createDesignerStore(1080, 1080);

    // Seed 50 linked image elements with filters.
    for (let i = 0; i < 50; i++) {
      store.getState().addElement({
        id: '',
        type: 'image',
        x: i * 10,
        y: i * 10,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        src: `https://example.com/img-${i}.png`,
        fitMode: 'cover',
        filters: ['grayscale', 'blur:2', 'brightness:1.1'],
      });
    }

    expect(store.getState().doc.outputs[0].children).toHaveLength(50);

    const ids = store.getState().doc.outputs[0].children.map((c) => c.id);

    // Simulate a drag: update every element's x/y by 5px.
    const dragStart = performance.now();
    for (const id of ids) {
      const el = store.getState().doc.outputs[0].children.find((c) => c.id === id)!;
      store.getState().updateElement(id, { x: el.x + 5, y: el.y + 5 });
    }
    const dragDuration = performance.now() - dragStart;

    // Add a second output so tab switching has work to do.
    store.getState().addOutput({ formatId: 'x-post', name: 'X Post', width: 1600, height: 900 });

    const switchStart = performance.now();
    store.getState().setCurrentOutput(1);
    store.getState().setCurrentOutput(0);
    const switchDuration = performance.now() - switchStart;

    // Generous budgets: 150ms for 50 drag updates, 50ms for two tab switches.
    expect(dragDuration).toBeLessThan(150);
    expect(switchDuration).toBeLessThan(50);
  });
});
