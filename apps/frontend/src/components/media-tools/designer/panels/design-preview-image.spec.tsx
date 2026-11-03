import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesignPreviewImage } from './design-preview-image';

describe('DesignPreviewImage', () => {
  it('falls back for a missing or broken source and recovers when the source changes', () => {
    const { rerender } = render(
      <DesignPreviewImage src={null} alt="Design" className="preview" fallback={<span>No preview</span>} />
    );
    expect(screen.getByText('No preview')).toBeTruthy();

    rerender(<DesignPreviewImage src="/broken.png" alt="Design" className="preview" fallback={<span>No preview</span>} />);
    fireEvent.error(screen.getByRole('img', { name: 'Design' }));
    expect(screen.getByText('No preview')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Design' })).toBeNull();

    rerender(<DesignPreviewImage src="/working.png" alt="Design" className="preview" fallback={<span>No preview</span>} />);
    expect(screen.getByRole('img', { name: 'Design' }).getAttribute('src')).toBe('/working.png');
  });
});
