import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { styleStringToRun, TextEditingOverlay } from './text-editing';
import type { DesignerElement } from './designer.store';

const toasterShow = vi.hoisted(() => vi.fn());
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toasterShow }),
}));

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

const commitRuns = (
  runs: Array<{ style: Partial<CSSStyleDeclaration>; text: string }>
) => {
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
  const spans = runs.map(({ style, text }) => {
    const span = document.createElement('span');
    Object.assign(span.style, style);
    span.textContent = text;
    return span;
  });
  editor.replaceChildren(...spans);
  fireEvent.blur(editor);
  expect(onUpdate).toHaveBeenCalledTimes(1);
  return onUpdate.mock.calls[0][1] as Partial<DesignerElement>;
};

const commitSpan = (style: Partial<CSSStyleDeclaration>, text = 'Pasted headline') =>
  commitRuns([{ style, text }]);

describe('TextEditingOverlay pasted styles', () => {
  beforeEach(() => toasterShow.mockReset());

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

  it('uses only the primary family from ordinary quoted and unquoted stacks', () => {
    const quoted = commitSpan({ fontFamily: '"Helvetica Neue", "Arial"' });
    expect(quoted.richText?.[0].fontFamily).toBe('Helvetica Neue');
    const unquoted = commitSpan({ fontFamily: 'Roboto, sans-serif' });
    expect(unquoted.richText?.[0].fontFamily).toBe('Roboto');
  });

  it('ignores non-pixel and below-minimum font sizes', () => {
    expect(commitSpan({ fontSize: '0.875em' }).richText?.[0].fontSize).toBeUndefined();
    expect(commitSpan({ fontSize: '0.5px' }).richText?.[0].fontSize).toBeUndefined();
  });

  it('drops an oversized run color while preserving other formatting', () => {
    const run = styleStringToRun(
      { color: 'x'.repeat(65), fontWeight: '700' } as CSSStyleDeclaration,
      {}
    );
    expect(run.fill).toBeUndefined();
    expect(run.fontWeight).toBe(700);
  });

  it('caps combined rich text at the save limit and warns visibly', () => {
    const update = commitRuns([
      { style: { fontWeight: '700' }, text: 'a'.repeat(12000) },
      { style: { fontStyle: 'italic' }, text: 'b'.repeat(8500) },
    ]);

    expect(update.text).toHaveLength(20000);
    expect(update.richText).toHaveLength(2);
    expect(update.richText?.[0]).toMatchObject({ fontWeight: 700 });
    expect(update.richText?.[0].text).toHaveLength(12000);
    expect(update.richText?.[1]).toMatchObject({ fontStyle: 'italic' });
    expect(update.richText?.[1].text).toHaveLength(8000);
    expect(toasterShow).toHaveBeenCalledWith(
      'Pasted text was shortened to the 20,000-character limit.',
      'warning'
    );
  });
});
