import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesignerAssistantPanel } from './designer-assistant-panel';
import { createDesignerStore } from '../designer.store';

const fetchMock = vi.hoisted(() => vi.fn());
const ensureFontLoaded = vi.hoisted(() => vi.fn());

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('../fonts', () => ({ ensureFontLoaded }));

const setup = () => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: 'text-1', type: 'text', text: 'Old headline', x: 0, y: 0, width: 400, height: 100,
    rotation: 0, opacity: 1, locked: false, hidden: false,
    richText: [{ text: 'Old headline', fontWeight: 700 }],
  });
  store.getState().setSelectedIds(['text-1']);
  return store;
};

const renderPanel = (store: ReturnType<typeof createDesignerStore>) => render(
  <DesignerAssistantPanel
    store={store}
    selectedElementId="text-1"
    selectedText="Old headline"
    context={{ type: 'text', text: 'Old headline' }}
  />
);

describe('DesignerAssistantPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    ensureFontLoaded.mockClear();
  });

  it('generates copy and applies the selected alternative with fresh text state', async () => {
    const store = setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ variants: ['New headline', 'Another option', 'Third option'] }),
    });
    renderPanel(store);
    fireEvent.change(screen.getByRole('textbox', { name: 'Design brief' }), {
      target: { value: 'Holiday sale' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate copy' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Apply text' }))[0]);

    const selected = (store.getState().doc.outputs[0] as any).children[0];
    expect(selected.text).toBe('New headline');
    expect(selected.richText).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('/media/designer-assistant/copy');
  });

  it('applies only whitelisted font/color suggestions', async () => {
    const store = setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [{
          category: 'font',
          title: 'Use a serif headline',
          rationale: 'Improve seasonal contrast',
          style: { fontFamily: 'Georgia', fill: '#123456' },
        }],
      }),
    });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: 'Smart suggestions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply style' }));

    expect((store.getState().doc.outputs[0] as any).children[0]).toMatchObject({
      fontFamily: 'Georgia',
      fill: '#123456',
    });
    expect(ensureFontLoaded).toHaveBeenCalledWith('Georgia');
    expect(fetchMock.mock.calls[0][0]).toBe('/media/designer-assistant/suggestions');
  });
});
