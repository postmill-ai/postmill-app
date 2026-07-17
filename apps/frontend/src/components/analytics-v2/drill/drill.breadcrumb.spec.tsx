import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DrillBreadcrumb } from './drill.breadcrumb';
import { DrillState } from '../utils';

describe('DrillBreadcrumb', () => {
  const onReset = vi.fn();
  const onNavigate = vi.fn();

  it('returns null when no drill state is active', () => {
    const drill: DrillState = { tab: 'overview' };
    const { container } = render(
      <DrillBreadcrumb drill={drill} onReset={onReset} onNavigate={onNavigate} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders breadcrumb with metric', () => {
    const drill: DrillState = { tab: 'overview', metric: 'impressions' };
    render(
      <DrillBreadcrumb drill={drill} onReset={onReset} onNavigate={onNavigate} />
    );
    expect(screen.getByText('impressions')).toBeTruthy();
  });

  it('renders breadcrumb with metric and channel name', () => {
    const drill: DrillState = { tab: 'overview', metric: 'impressions', focusIntegration: 'i1' };
    render(
      <DrillBreadcrumb
        drill={drill}
        onReset={onReset}
        onNavigate={onNavigate}
        channelName="Twitter"
      />
    );
    expect(screen.getByText('impressions')).toBeTruthy();
    expect(screen.getByText('Twitter')).toBeTruthy();
  });

  it('renders breadcrumb with date', () => {
    const drill: DrillState = { tab: 'overview', metric: 'impressions', focusDate: '2024-06-15' };
    render(
      <DrillBreadcrumb drill={drill} onReset={onReset} onNavigate={onNavigate} />
    );
    expect(screen.getByText('2024-06-15')).toBeTruthy();
  });

  it('renders breadcrumb with post content', () => {
    const drill: DrillState = {
      tab: 'overview',
      metric: 'impressions',
      focusPost: 'p1',
    };
    render(
      <DrillBreadcrumb
        drill={drill}
        onReset={onReset}
        onNavigate={onNavigate}
        postContent="Hello world announcement"
      />
    );
    expect(screen.getByText('Hello world announcement')).toBeTruthy();
  });

  it('truncates long post content', () => {
    const drill: DrillState = {
      tab: 'overview',
      metric: 'impressions',
      focusPost: 'p1',
    };
    const long = 'This is a very long post content that should be truncated at thirty characters';
    const expected = long.slice(0, 30) + '...';
    render(
      <DrillBreadcrumb
        drill={drill}
        onReset={onReset}
        onNavigate={onNavigate}
        postContent={long}
      />
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('shows tab name in breadcrumb when tab is not overview', () => {
    const drill: DrillState = { tab: 'channels', focusIntegration: 'i1' };
    render(
      <DrillBreadcrumb
        drill={drill}
        onReset={onReset}
        onNavigate={onNavigate}
        channelName="Twitter"
      />
    );
    expect(screen.getByText('Channels')).toBeTruthy();
  });

  it('renders Reset button', () => {
    const drill: DrillState = { tab: 'overview', metric: 'impressions' };
    render(
      <DrillBreadcrumb drill={drill} onReset={onReset} onNavigate={onNavigate} />
    );
    expect(screen.getByText('Reset')).toBeTruthy();
  });

  it('calls onReset when Reset button is clicked', () => {
    const drill: DrillState = { tab: 'overview', metric: 'impressions' };
    render(
      <DrillBreadcrumb drill={drill} onReset={onReset} onNavigate={onNavigate} />
    );
    screen.getByText('Reset').click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('calls onNavigate when a breadcrumb item is clicked', () => {
    const drill: DrillState = { tab: 'overview', metric: 'impressions' };
    render(
      <DrillBreadcrumb drill={drill} onReset={onReset} onNavigate={onNavigate} />
    );
    screen.getByText('impressions').click();
    expect(onNavigate).toHaveBeenCalledWith({
      metric: undefined,
      focusDate: undefined,
      focusPost: undefined,
    });
  });

  it('calls onNavigate when tab crumb is clicked', () => {
    const drill: DrillState = { tab: 'channels', focusIntegration: 'i1' };
    render(
      <DrillBreadcrumb
        drill={drill}
        onReset={onReset}
        onNavigate={onNavigate}
        channelName="Twitter"
      />
    );
    screen.getByText('Channels').click();
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'channels' });
  });
});
