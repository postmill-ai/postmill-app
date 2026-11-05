import { describe, expect, it, vi } from 'vitest';
import { trySetPointerCapture } from './pointer-capture';

describe('trySetPointerCapture', () => {
  it('captures an active pointer', () => {
    const element = { setPointerCapture: vi.fn() } as unknown as Element;
    expect(trySetPointerCapture(element, 7)).toBe(true);
    expect(element.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('returns false when the pointer is no longer active', () => {
    const element = {
      setPointerCapture: vi.fn(() => {
        throw new DOMException('No active pointer', 'NotFoundError');
      }),
    } as unknown as Element;
    expect(trySetPointerCapture(element, 7)).toBe(false);
  });

  it('returns false when pointer capture is unavailable', () => {
    expect(trySetPointerCapture({} as Element, 7)).toBe(false);
  });

  it('does not suppress unrelated failures', () => {
    const failure = new Error('broken implementation');
    const element = {
      setPointerCapture: vi.fn(() => {
        throw failure;
      }),
    } as unknown as Element;
    expect(() => trySetPointerCapture(element, 7)).toThrow(failure);
  });
});
