import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { TextEditingOverlay } from './text-editing';
import type { DesignerElement } from './designer.store';

vi.mock('./measure-text', () => ({
  fittedFontSize: (el: DesignerElement) => el.fontSize ?? 16,
  growBoxFor: () => ({}),
}));

const element = {
  id: 'text-1',
  type: 'text',
  text: 'Hello world',
  x: 0,
  y: 0,
  width: 240,
  height: 60,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  fontFamily: 'Arial',
  fontSize: 16,
  fill: '#000000',
} as DesignerElement;

const setup = () => {
  const onUpdate = vi.fn();
  const onComplete = vi.fn();
  const utils = render(
    <TextEditingOverlay
      element={element}
      stageRect={{ x: 0, y: 0, scale: 1 }}
      onUpdate={onUpdate}
      onComplete={onComplete}
    />
  );
  const editor = utils.container.querySelector('[data-text-editor-id]') as HTMLElement;
  const textNode = editor.firstChild as Text;
  return { ...utils, editor, textNode, onUpdate, onComplete };
};

describe('TextEditingOverlay text color', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('colors only the selected range without completing the edit', () => {
    const { editor, textNode, onUpdate, onComplete } = setup();
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const input = editor.parentElement!.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.input(input, { target: { value: '#ff0000' } });
    fireEvent.input(input, { target: { value: '#00ff00' } });

    expect(document.execCommand).toHaveBeenCalledWith('foreColor', false, '#ff0000');
    expect(document.execCommand).toHaveBeenCalledWith('foreColor', false, '#00ff00');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.blur(editor);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(editor.textContent).toBe('Hello world');
  });

  it('updates the element color for a collapsed selection', () => {
    const { editor, textNode, onUpdate } = setup();
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const input = editor.parentElement!.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: '#123456' } });

    expect(onUpdate).toHaveBeenCalledWith('text-1', { fill: '#123456' });
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('serializes Chrome font-color elements into rich-text runs', () => {
    const { editor, onUpdate } = setup();
    editor.innerHTML = 'Hello <font color="#ff0000">world</font>';

    fireEvent.blur(editor);

    expect(onUpdate).toHaveBeenCalledWith('text-1', {
      text: 'Hello world',
      richText: [{ text: 'Hello ' }, { text: 'world', fill: '#ff0000' }],
    });
  });
});
