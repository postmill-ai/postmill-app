import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { TextEditingOverlay } from './text-editing';
import type { DesignerElement } from './designer.store';

const element = {
  id: 't1',
  type: 'text',
  x: 0,
  y: 0,
  width: 400,
  height: 80,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  text: 'Original',
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: 400,
} as unknown as DesignerElement;

const commitSpan = (style: Partial<CSSStyleDeclaration>) => {
  const onUpdate = vi.fn();
  const { container } = render(
    <TextEditingOverlay
      element={element}
      stageRect={{ x: 0, y: 0, scale: 1 }}
      onUpdate={onUpdate}
      onComplete={() => {}}
    />
  );
  const editor = container.querySelector('[data-text-editor-id]') as HTMLElement;
  const span = document.createElement('span');
  Object.assign(span.style, style);
  span.textContent = 'Pasted headline';
  editor.replaceChildren(span);
  fireEvent.blur(editor);
  expect(onUpdate).toHaveBeenCalledTimes(1);
  return onUpdate.mock.calls[0][1] as Partial<DesignerElement>;
};

describe('TextEditingOverlay pasted font families', () => {
  it('keeps the primary family from an oversized CSS fallback stack', () => {
    const fallbacks = Array.from({ length: 30 }, (_, i) => `"Fallback ${i}"`).join(', ');
    const update = commitSpan({
      fontFamily: `"Primary QA Font", ${fallbacks}`,
      fontWeight: '700',
    });

    expect(update.text).toBe('Pasted headline');
    expect(update.richText).toHaveLength(1);
    expect(update.richText?.[0]).toMatchObject({
      text: 'Pasted headline',
      fontFamily: 'Primary QA Font',
      fontWeight: 700,
    });
    expect(update.richText?.[0].fontFamily?.length).toBeLessThanOrEqual(200);
  });

  it('inherits the element font when an oversized value has no usable primary family', () => {
    const update = commitSpan({
      fontFamily: 'x'.repeat(201),
      fontStyle: 'italic',
    });

    expect(update.text).toBe('Pasted headline');
    expect(update.richText?.[0].fontFamily).toBeUndefined();
    expect(update.richText?.[0].fontStyle).toBe('italic');
  });

  it('preserves an ordinary short CSS font stack', () => {
    const update = commitSpan({ fontFamily: 'Arial, sans-serif' });
    expect(update.richText?.[0].fontFamily).toBe('Arial, sans-serif');
  });
});
