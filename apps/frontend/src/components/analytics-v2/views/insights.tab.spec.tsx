import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

// Shallow-render the composition — stub the five child surfaces so this spec
// covers InsightsTab itself (pills, section anchors, scroll effect).
vi.mock('./best-time.tab', () => ({ BestTimeTab: () => <div data-testid="best-time" /> }));
vi.mock('./recommendations.tab', () => ({ RecommendationsTab: () => <div data-testid="recs" /> }));
vi.mock('./alerts.section', () => ({ AlertsSection: () => <div data-testid="alerts" /> }));
vi.mock('./content-insights.section', () => ({
  ContentInsightsSection: () => <div data-testid="content" />,
}));
vi.mock('./health.section', () => ({ HealthSection: () => <div data-testid="health" /> }));

import { InsightsTab } from './insights.tab';

describe('InsightsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the five anchor pills and section mount points', () => {
    const { container } = render(<InsightsTab integrations={['i1']} />);
    // Several labels appear twice (anchor pill + section <h2>) — assert presence.
    for (const label of ['Best time', 'Recommendations', 'What works', 'Alerts', 'Channel health']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    for (const id of [
      'insights-best-time',
      'insights-recommendations',
      'insights-content',
      'insights-alerts',
      'insights-health',
    ]) {
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
    // all five child surfaces mount
    expect(screen.getByTestId('best-time')).toBeTruthy();
    expect(screen.getByTestId('health')).toBeTruthy();
  });

  it('scrolls to the requested section on mount (legacy ?tab mapping)', () => {
    const scrollIntoView = vi.fn();
    const el = document.createElement('div');
    el.scrollIntoView = scrollIntoView;
    const spy = vi.spyOn(document, 'getElementById').mockReturnValue(el);
    render(<InsightsTab section="alerts" />);
    expect(spy).toHaveBeenCalledWith('insights-alerts');
    expect(scrollIntoView).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not scroll when no section is given', () => {
    const spy = vi.spyOn(document, 'getElementById');
    render(<InsightsTab />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
