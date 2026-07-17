import { describe, it, expect } from 'vitest';
import { runsToHtml } from './text-editing';
import type { DesignerElement, TextRun } from './designer.store';

const el = {
  id: 't1',
  type: 'text',
  x: 0,
  y: 0,
  width: 200,
  height: 50,
  fill: '#000000',
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: 400,
} as unknown as DesignerElement;

describe('runsToHtml escaping', () => {
  it('escapes HTML in run text fed to dangerouslySetInnerHTML', () => {
    const html = runsToHtml(
      [{ text: '<img src=x onerror=alert(1)>' } as unknown as TextRun],
      el
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('still converts newlines to <br> after escaping', () => {
    const html = runsToHtml([{ text: 'a\nb' } as unknown as TextRun], el);
    expect(html).toContain('a<br>b');
  });
});
