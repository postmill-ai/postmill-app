import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FillSection, TextStrokeSection } from './fill-section';

describe('shared video text style controls', () => {
  it('creates a gradient through FillSection and edits outline color/width', () => {
    const setFill = vi.fn();
    const setStroke = vi.fn();
    const { rerender } = render(
      <>
        <FillSection element={{ fill: '#112233' }} set={setFill} />
        <TextStrokeSection element={{}} set={setStroke} />
      </>
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Gradient' }));
    expect(setFill).toHaveBeenCalledWith({
      fillGradient: {
        type: 'linear',
        angle: 0,
        stops: [
          { offset: 0, color: '#112233' },
          { offset: 1, color: '#FFFFFF' },
        ],
      },
    });

    fireEvent.click(screen.getByRole('switch', { name: 'Outline' }));
    expect(setStroke).toHaveBeenLastCalledWith({
      textStroke: { color: '#000000', width: 2 },
    });

    rerender(
      <TextStrokeSection
        element={{ textStroke: { color: '#123456', width: 2 } }}
        set={setStroke}
      />
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width' }), {
      target: { value: '6' },
    });
    expect(setStroke).toHaveBeenLastCalledWith({
      textStroke: { color: '#123456', width: 6 },
    });
  });
});
