import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockFetch = vi.fn();
const mockToasterShow = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('@postmill-ai/frontend/components/settings/brand/use-brands', () => ({
  useBrands: () => ({ data: [] }),
}));

vi.mock('@postmill-ai/frontend/components/media-tools/media-selector-modal', () => ({
  MediaSelectorModal: () => <div data-testid="media-selector-mock" />,
}));

import { AiDesignerStart } from './ai-designer-start';

// Sessions are single-mode: the start screen asks for the output type first
// and only shows the matching format list — image formats under
// "Channels / Image", video formats under "Channels / Video".
describe('AI Designer output-type chooser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to the image view: image formats visible, video formats hidden', () => {
    render(<AiDesignerStart onStart={vi.fn()} isConnected />);

    expect(screen.getByText('Channels / Image')).toBeTruthy();
    expect(screen.getByText('Instagram Post')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Custom sizes/i })).toBeTruthy();
    expect(screen.queryByText('Channels / Video')).toBeNull();
    expect(screen.queryByText('YouTube Short')).toBeNull();
  });

  it('switching to Video shows video formats and hides the image list', () => {
    render(<AiDesignerStart onStart={vi.fn()} isConnected />);

    fireEvent.click(screen.getByRole('button', { name: 'Video' }));

    expect(screen.getByText('Channels / Video')).toBeTruthy();
    expect(screen.getByText('YouTube Short')).toBeTruthy();
    expect(screen.queryByText('Channels / Image')).toBeNull();
    expect(screen.queryByText('Instagram Post')).toBeNull();
    expect(screen.queryByRole('button', { name: /Custom sizes/i })).toBeNull();
  });

  it('switching the output type clears the previous selection', () => {
    const onStart = vi.fn();
    render(<AiDesignerStart onStart={onStart} isConnected />);

    // Select an image format, then bounce Image -> Video -> Image.
    // (The mocked translator doesn't interpolate, so the count badge renders
    // as the raw fallback '{{count}} selected'.)
    fireEvent.click(screen.getByText('Instagram Post'));
    expect(screen.getByText('{{count}} selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));

    // The stale image selection must not survive the round trip…
    expect(screen.queryByText('{{count}} selected')).toBeNull();

    // …and Start is blocked until a fresh pick is made.
    fireEvent.click(screen.getByText('Start designing'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('a video selection produces a video-only start payload', () => {
    const onStart = vi.fn();
    render(<AiDesignerStart onStart={onStart} isConnected />);

    fireEvent.click(screen.getByRole('button', { name: 'Video' }));
    fireEvent.click(screen.getByText('YouTube Short'));
    fireEvent.click(screen.getByText('Start designing'));

    expect(onStart).toHaveBeenCalledTimes(1);
    const payload = onStart.mock.calls[0][0];
    expect(payload.config.channels).toEqual(['short']);
    expect(payload.config.customSizes).toBeUndefined();
  });
});
