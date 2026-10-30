import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CornerRadiusControl } from './corner-radius-control';
import { TextStyleControl } from './text-style-control';

describe('CornerRadiusControl', () => {
  it('switches between scalar and per-corner values and edits one corner', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CornerRadiusControl value={8} width={200} height={100} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Per corner' }));
    expect(onChange).toHaveBeenLastCalledWith([8, 8, 8, 8]);

    rerender(<CornerRadiusControl value={[8, 8, 8, 8]} width={200} height={100} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Top right' }), { target: { value: '17' } });
    expect(onChange).toHaveBeenLastCalledWith([8, 17, 8, 8]);
  });
});

describe('TextStyleControl', () => {
  it.each([
    ['Normal', { fontWeight: 400, fontStyle: 'normal' }],
    ['Bold', { fontWeight: 700, fontStyle: 'normal' }],
    ['Italic', { fontWeight: 400, fontStyle: 'italic' }],
    ['Bold Italic', { fontWeight: 700, fontStyle: 'italic' }],
  ])('applies %s', (label, expected) => {
    const onChange = vi.fn();
    render(<TextStyleControl fontWeight={400} fontStyle="normal" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: label }));
    expect(onChange).toHaveBeenCalledWith(expected);
  });
});
