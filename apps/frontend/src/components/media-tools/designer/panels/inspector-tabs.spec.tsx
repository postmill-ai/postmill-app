import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InspectorSection,
  InspectorTabGroup,
  effectsTabFor,
  inspectorTabsFor,
  readInspectorTabPreference,
  useInspectorTabState,
  writeInspectorTabPreference,
} from './inspector-tabs';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const flushHydration = () => act(async () => {});

const keys = (category: Parameters<typeof inspectorTabsFor>[0]) =>
  inspectorTabsFor(category).map((tab) => tab.key);

describe('inspectorTabsFor', () => {
  it('gives image Layout | Style | AI Tools and text Layout | Text | Effects', () => {
    expect(keys('image')).toEqual(['layout', 'style', 'ai']);
    expect(keys('text')).toEqual(['layout', 'text', 'effects']);
  });

  it('gives the remaining categories an equivalent Layout | Style grouping', () => {
    for (const category of ['shape', 'path', 'icon', 'symbol', 'fill', 'group', 'mixed'] as const) {
      expect(keys(category)).toEqual(['layout', 'style']);
    }
    expect(keys('adjustment')).toEqual(['layout', 'adjust']);
  });

  it('hosts the shared effects list on Effects for text and Style elsewhere', () => {
    expect(effectsTabFor('text')).toBe('effects');
    expect(effectsTabFor('image')).toBe('style');
    expect(effectsTabFor('mixed')).toBe('style');
  });
});

describe('inspector tab persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('drops stored tabs that the category does not offer', () => {
    localStorage.setItem(
      'designer-inspector-tabs',
      JSON.stringify({ tabs: { image: 'ai', text: 'ai', bogus: 'layout' }, sections: { 'image:filters': false } }),
    );
    const preference = readInspectorTabPreference(localStorage);
    expect(preference.tabs).toEqual({ image: 'ai' });
    expect(preference.sections).toEqual({ 'image:filters': false });
  });

  it('survives malformed storage and keeps orgs on separate keys', () => {
    localStorage.setItem('designer-inspector-tabs-org-a', '{not json');
    expect(readInspectorTabPreference(localStorage, 'org-a').tabs).toEqual({});

    writeInspectorTabPreference(localStorage, 'org-a', { tabs: { image: 'ai' }, sections: {} });
    writeInspectorTabPreference(localStorage, 'org-b', { tabs: { image: 'style' }, sections: {} });
    expect(readInspectorTabPreference(localStorage, 'org-a').tabs.image).toBe('ai');
    expect(readInspectorTabPreference(localStorage, 'org-b').tabs.image).toBe('style');
    expect(readInspectorTabPreference(localStorage).tabs).toEqual({});
  });

  it('defaults to the first tab, then restores the stored tab per category on remount', async () => {
    const { result, unmount } = renderHook(() => useInspectorTabState('image', 'org-a'));
    await flushHydration();
    expect(result.current.tab).toBe('layout');

    act(() => result.current.setTab('ai'));
    expect(result.current.tab).toBe('ai');
    unmount();

    const text = renderHook(() => useInspectorTabState('text', 'org-a'));
    await flushHydration();
    // Another category is untouched by the image preference.
    expect(text.result.current.tab).toBe('layout');
    text.unmount();

    const remounted = renderHook(() => useInspectorTabState('image', 'org-a'));
    await flushHydration();
    expect(remounted.result.current.tab).toBe('ai');
    remounted.unmount();

    const otherOrg = renderHook(() => useInspectorTabState('image', 'org-b'));
    await flushHydration();
    expect(otherOrg.result.current.tab).toBe('layout');
    otherOrg.unmount();
  });

  it('persists collapsible-section state per category', async () => {
    const { result, unmount } = renderHook(() => useInspectorTabState('image', 'org-a'));
    await flushHydration();
    expect(result.current.sectionOpen('filters')).toBe(true);

    act(() => result.current.toggleSection('filters'));
    expect(result.current.sectionOpen('filters')).toBe(false);
    unmount();

    const remounted = renderHook(() => useInspectorTabState('image', 'org-a'));
    await flushHydration();
    expect(remounted.result.current.sectionOpen('filters')).toBe(false);
    remounted.unmount();

    const text = renderHook(() => useInspectorTabState('text', 'org-a'));
    await flushHydration();
    expect(text.result.current.sectionOpen('filters')).toBe(true);
    text.unmount();
  });
});

describe('InspectorTabGroup', () => {
  it('hides inactive groups without unmounting them, and shows everything without a tab', () => {
    const { rerender } = render(
      <>
        <InspectorTabGroup for="layout" active="layout"><input aria-label="X" /></InspectorTabGroup>
        <InspectorTabGroup for="style" active="layout"><input aria-label="Fill" /></InspectorTabGroup>
      </>,
    );
    expect(screen.getByLabelText('X').closest('[hidden]')).toBeNull();
    expect(screen.getByLabelText('Fill').closest('[hidden]')).not.toBeNull();

    rerender(
      <>
        <InspectorTabGroup for="layout" active="style"><input aria-label="X" /></InspectorTabGroup>
        <InspectorTabGroup for="style" active="style"><input aria-label="Fill" /></InspectorTabGroup>
      </>,
    );
    expect(screen.getByLabelText('X').closest('[hidden]')).not.toBeNull();
    expect(screen.getByLabelText('Fill').closest('[hidden]')).toBeNull();

    rerender(
      <>
        <InspectorTabGroup for="layout"><input aria-label="X" /></InspectorTabGroup>
        <InspectorTabGroup for="style"><input aria-label="Fill" /></InspectorTabGroup>
      </>,
    );
    expect(screen.getByLabelText('X').closest('[hidden]')).toBeNull();
    expect(screen.getByLabelText('Fill').closest('[hidden]')).toBeNull();
  });
});

describe('InspectorSection', () => {
  it('collapses without unmounting the body and reopens with its draft intact', () => {
    render(
      <InspectorSection id="filters" title="Filters">
        <input aria-label="Blur" defaultValue="3" />
      </InspectorSection>,
    );
    const input = screen.getByLabelText('Blur') as HTMLInputElement;
    expect(input.closest('[hidden]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Blur').closest('[hidden]')).not.toBeNull();
    expect((screen.getByLabelText('Blur') as HTMLInputElement).value).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Blur').closest('[hidden]')).toBeNull();
  });
});
