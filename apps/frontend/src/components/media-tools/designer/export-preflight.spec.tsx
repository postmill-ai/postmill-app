import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExportPreflight } from './export-preflight';
import type { DesignerPreflightFinding } from './design-preflight';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars: Record<string, string | number>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(vars[name])),
}));

const finding: DesignerPreflightFinding = {
  rule: 'low-contrast',
  key: 'designer_preflight_low_contrast',
  vars: { ratio: '4.5', target: 'Poster / Page 1' },
  outputIndex: 0,
  pageNumber: 0,
  elementId: 'text-1',
};

describe('ExportPreflight', () => {
  it('renders actionable warnings and forwards the selected finding', () => {
    const onFinding = vi.fn();
    render(<ExportPreflight result={{ findings: [finding], unassessed: { contrast: 0, text: 0, geometry: 0 } }} onFinding={onFinding} />);

    fireEvent.click(screen.getByRole('button', { name: 'Low contrast (4.5:1) on Poster / Page 1' }));
    expect(onFinding).toHaveBeenCalledWith(finding);
  });

  it('reports unassessed checks without presenting them as violations', () => {
    render(<ExportPreflight result={{ findings: [], unassessed: { contrast: 1, text: 2, geometry: 1 } }} onFinding={vi.fn()} />);

    expect(screen.getByText('4 check(s) could not be assessed')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('returns nothing for a fully assessed clean result', () => {
    const { container } = render(<ExportPreflight result={{ findings: [], unassessed: { contrast: 0, text: 0, geometry: 0 } }} onFinding={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
