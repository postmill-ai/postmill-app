import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PicksSocialsComponent } from './picks.socials.component';
import { useLaunchStore } from './store';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: ({ src, alt, className, width, height }: any) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img src={src} alt={alt} className={className} width={width} height={height} />
  ),
}));

vi.mock('@gitroom/react/helpers/image.with.fallback', () => ({
  default: ({ src, alt, className, style, width, height }: any) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img src={src} alt={alt} className={className} style={style} width={width} height={height} />
  ),
}));

const makeIntegrations = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `int-${i}`,
    name: `Channel ${i + 1}`,
    identifier: i < 2 ? 'twitter' : i < 4 ? 'linkedin' : 'facebook',
    picture: '/pic.png',
    inBetweenSteps: false,
    disabled: false,
    editor: 'normal' as const,
    display: 'Channel',
    type: 'social',
  }));

describe('PicksSocialsComponent', () => {
  beforeEach(() => {
    useLaunchStore.setState({
      integrations: makeIntegrations(8),
      selectedIntegrations: [],
      locked: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders icon row when there are 4 or fewer selectable integrations', () => {
    useLaunchStore.setState({ integrations: makeIntegrations(4) });
    const { container } = render(<PicksSocialsComponent toolTip />);
    const channelWrappers = container.querySelectorAll(
      '.flex.flex-wrap.gap-\\[12px\\].flex-1 > div'
    );
    expect(channelWrappers.length).toBe(4);
    expect(screen.queryByRole('button', { name: /select channels/i })).toBeNull();
  });

  it('renders dropdown trigger when there are more than 4 selectable integrations', () => {
    render(<PicksSocialsComponent />);
    expect(screen.getByRole('button', { name: /select channels/i })).toBeDefined();
  });

  it('opens dropdown and filters by search', () => {
    render(<PicksSocialsComponent />);
    const trigger = screen.getByRole('button', { name: /select channels/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getAllByRole('option').length).toBe(8);

    const search = screen.getByPlaceholderText(/search channels/i);
    fireEvent.change(search, { target: { value: 'Channel 1' } });
    expect(screen.getAllByRole('option').length).toBe(1);
  });

  it('toggles selection via checkboxes and calls store action', () => {
    const spy = vi.spyOn(useLaunchStore.getState(), 'addOrRemoveSelectedIntegration');
    render(<PicksSocialsComponent />);
    fireEvent.click(screen.getByRole('button', { name: /select channels/i }));
    const options = screen.getAllByRole('option');
    fireEvent.click(options[0]);
    // Options are grouped alphabetically by platform; facebook group is first.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'int-4' }),
      {}
    );
    spy.mockRestore();
  });

  it('closes dropdown on Escape', () => {
    render(<PicksSocialsComponent />);
    fireEvent.click(screen.getByRole('button', { name: /select channels/i }));
    expect(screen.queryByRole('listbox')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes dropdown on outside click', () => {
    render(<PicksSocialsComponent />);
    fireEvent.click(screen.getByRole('button', { name: /select channels/i }));
    expect(screen.queryByRole('listbox')).toBeDefined();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('exposes aria-expanded on the dropdown trigger', () => {
    render(<PicksSocialsComponent />);
    const trigger = screen.getByRole('button', { name: /select channels/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
