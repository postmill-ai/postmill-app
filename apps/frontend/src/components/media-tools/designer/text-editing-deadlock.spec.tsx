import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, renderHook, act, fireEvent } from '@testing-library/react';
import Konva from 'konva';
import { Stage, Layer } from 'react-konva';
import { createDesignerStore, type DesignerElement, type DesignerOutput } from './designer.store';
import { CanvasElements } from './elements';
import { TextEditingOverlay, useTextEditTargetGuard } from './text-editing';

/**
 * Regression: "text box doesn't respond, text reverts."
 *
 * The overlay committed only on blur, so when the edit target disappeared
 * mid-edit (output switch, undo, a collab doc replace) the overlay unmounted
 * WITHOUT a blur: the edit was lost and `editingTextId` leaked, which
 * short-circuited the canvas keyboard handler and kept the Konva text node
 * hidden — an unresponsive, invisible text box.
 *
 * The fix: a guard clears `editingTextId` the moment the target stops
 * resolving, and the overlay settles exactly once — committing through the
 * same `buildTextEditCommit` path on unmount when the user never blurred.
 */

const textEl = (over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Hello',
    fontFamily: 'Arial',
    fontSize: 16,
    fontWeight: 400,
    ...over,
  }) as unknown as DesignerElement;

const storeWithText = () => {
  const store = createDesignerStore(400, 400);
  store.getState().addElement(textEl());
  return store;
};

const currentOutput = (store: ReturnType<typeof createDesignerStore>) =>
  store.getState().doc.outputs[store.getState().currentOutput] as DesignerOutput;

describe('useTextEditTargetGuard', () => {
  const useHarness = (store: ReturnType<typeof createDesignerStore>) => {
    const [editingTextId, setEditingTextId] = useState<string | null>('t1');
    const output = store((s) => s.doc.outputs[s.currentOutput]);
    const symbols = store((s) => s.doc.symbols);
    useTextEditTargetGuard({
      editingTextId,
      output: output as DesignerOutput,
      symbols,
      isVideo: false,
      onClear: () => setEditingTextId(null),
    });
    return editingTextId;
  };

  it('keeps the id while the target resolves', () => {
    const store = storeWithText();
    const { result } = renderHook(() => useHarness(store));
    expect(result.current).toBe('t1');
  });

  it('clears the id when the target disappears mid-edit', () => {
    const store = storeWithText();
    const { result } = renderHook(() => useHarness(store));
    expect(result.current).toBe('t1');

    // Undo / output switch / collab replace, distilled: the layer is gone.
    act(() => {
      store.getState().removeElements(['t1']);
    });
    expect(result.current).toBeNull();
  });

  it('clears the id when the target stops being a text element', () => {
    const store = storeWithText();
    const { result } = renderHook(() => useHarness(store));
    act(() => {
      // A type swap makes resolution fail the same way a delete does.
      store.getState().updateElement('t1', { type: 'shape' } as never);
    });
    expect(result.current).toBeNull();
  });
});

describe('Konva text visibility around an edit', () => {
  it('hides the node under the overlay and restores it when editing ends', () => {
    let stage: Konva.Stage | null = null;
    const tree = (editingTextId: string | null) => (
      <Stage width={400} height={400} ref={(s) => (stage = s)}>
        <Layer>
          <CanvasElements
            elements={[textEl()]}
            onSelect={() => {}}
            editingTextId={editingTextId}
          />
        </Layer>
      </Stage>
    );
    const { rerender } = render(tree('t1'));
    expect(stage!.findOne('#t1')!.visible()).toBe(false);

    // What the guard's onClear restores: editingTextId back to null.
    rerender(tree(null));
    expect(stage!.findOne('#t1')!.visible()).toBe(true);
  });
});

describe('TextEditingOverlay settle-once semantics', () => {
  const setup = (over: Partial<DesignerElement> = {}) => {
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    const utils = render(
      <TextEditingOverlay
        element={textEl(over)}
        stageRect={{ x: 0, y: 0, scale: 1 }}
        onUpdate={onUpdate}
        onComplete={onComplete}
      />
    );
    const editor = utils.container.querySelector(
      '[data-text-editor-id]'
    ) as HTMLElement;
    return { ...utils, editor, onUpdate, onComplete };
  };

  it('commits through buildTextEditCommit when unmounted mid-edit (no blur)', () => {
    const { editor, onUpdate, onComplete, unmount } = setup();
    // The user typed but the overlay went away without blurring.
    editor.innerHTML = 'Hello world';

    unmount();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('t1', {
      text: 'Hello world',
      richText: undefined,
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('commits once on blur and not again on the unmount that follows', () => {
    const { editor, onUpdate, onComplete, unmount } = setup();
    editor.innerHTML = 'Changed';

    fireEvent.blur(editor);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('t1', { text: 'Changed', richText: undefined });
    expect(onComplete).toHaveBeenCalledTimes(1);

    unmount();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Escape discards, always completes, and unmount does not resurrect the edit', () => {
    const { editor, onUpdate, onComplete, unmount } = setup();
    editor.innerHTML = 'Typed but discarded';

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);

    unmount();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not write when nothing changed', () => {
    const { editor, onUpdate, onComplete, unmount } = setup();
    fireEvent.blur(editor);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    unmount();
  });
});
