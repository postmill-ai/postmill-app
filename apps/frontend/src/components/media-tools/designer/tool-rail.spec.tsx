import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolRail } from './tool-rail';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

describe('ToolRail Brand access', () => {
  it('opens Brand from a visible rail action and reflects its open state', () => {
    const onOpenBrand = vi.fn();
    const { rerender } = render(
      <ToolRail
        activeTool="move"
        lastToolPerGroup={{}}
        onSelect={vi.fn()}
        aiAvailable
        onOpenBrand={onOpenBrand}
      />
    );
    const brand = screen.getByRole('button', { name: 'Brand', exact: true });
    expect(brand.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(brand);
    expect(onOpenBrand).toHaveBeenCalledOnce();

    rerender(
      <ToolRail
        activeTool="move"
        lastToolPerGroup={{}}
        onSelect={vi.fn()}
        aiAvailable
        onOpenBrand={onOpenBrand}
        brandOpen
      />
    );
    expect(screen.getByRole('button', { name: 'Brand', exact: true }).getAttribute('aria-pressed')).toBe('true');
  });
});
