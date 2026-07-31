import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type {
  AiDesignerMessagePayload,
  DesignPlan,
} from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.types';

const { openModalMock } = vi.hoisted(() => ({ openModalMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// The Designer is lazy-loaded via next/dynamic; stub it so the modal children
// can be rendered without pulling Konva into the test.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => (props: any) => (
    <div data-testid="designer-stub" data-design-id={props.designId} />
  ),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: openModalMock }),
}));

vi.mock('@postmill-ai/frontend/components/shared/safe-content', () => ({
  SafeContent: ({ content }: any) => (
    <div dangerouslySetInnerHTML={{ __html: content }} />
  ),
}));

// The intake form pulls in the media-selector chain — irrelevant here.
vi.mock('./interactive-form', () => ({
  InteractiveForm: () => <div data-testid="interactive-form" />,
}));

import { MessageRenderer } from './message-renderer';

// `texts` lands on DesignPlan with the backend plan-time-copy change; the
// factory carries it through the cast so the wire shape is exercised today.
const makePlan = (
  overrides: Record<string, unknown> = {}
): DesignPlan =>
  ({
    variantId: 'v1',
    skill: 'advertisement',
    concept: 'Bold Labor Day Sale concept',
    palette: ['#ff0000'],
    typeScale: {},
    background: { kind: 'solid', value: '#ffffff' },
    slots: [
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'cta', role: 'cta', kind: 'cta-button' },
      { id: 'hero', role: 'hero-image', kind: 'image' },
    ],
    assetNeeds: [],
    ...overrides,
  }) as DesignPlan;

const planMessage = (plans: DesignPlan[]): AiDesignerMessagePayload =>
  ({
    id: 'msg-1',
    seq: 1,
    sessionId: 'session-1',
    role: 'assistant',
    agent: 'art-director',
    kind: 'plan',
    content: {
      kind: 'plan',
      brief: { intent: 'Labor Day Sale social media post' },
      plans,
      actions: ['accept', 'revise'],
    },
    createdAt: new Date().toISOString(),
  }) as AiDesignerMessagePayload;

const renderPlan = (plans: DesignPlan[]) => {
  const onAcceptPlan = vi.fn();
  render(
    <MessageRenderer
      message={planMessage(plans)}
      onAcceptPlan={onAcceptPlan}
      onRevisePlan={vi.fn()}
      onFormSubmit={vi.fn()}
    />
  );
  return onAcceptPlan;
};

describe('PlanMessage inline copy editing', () => {
  it('renders one input per copy slot, initialized from plan.texts', () => {
    renderPlan([
      makePlan({
        texts: { headline: 'Labor Day Sale!', cta: 'Shop Now' },
      }),
    ]);

    // Copy slots (text + cta-button) get inputs; the image slot does not.
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByDisplayValue('Labor Day Sale!')).toBeTruthy();
    expect(screen.getByDisplayValue('Shop Now')).toBeTruthy();
    // Humanized slot roles label the inputs.
    expect(screen.getByText('Headline')).toBeTruthy();
    expect(screen.getByText('Cta')).toBeTruthy();
  });

  it('sends the edited texts for the selected plan on Accept', () => {
    const onAcceptPlan = renderPlan([
      makePlan({
        texts: { headline: 'Labor Day Sale!', cta: 'Shop Now' },
      }),
    ]);

    fireEvent.change(screen.getByDisplayValue('Labor Day Sale!'), {
      target: { value: 'Final Hours: Labor Day Sale!' },
    });
    fireEvent.click(screen.getByText('Accept plan'));

    expect(onAcceptPlan).toHaveBeenCalledWith('msg-1', 'v1', {
      v1: { headline: 'Final Hours: Labor Day Sale!', cta: 'Shop Now' },
    });
  });

  it('only sends texts for the selected plans', () => {
    const onAcceptPlan = renderPlan([
      makePlan({ variantId: 'v1', texts: { headline: 'Concept A', cta: 'Buy' } }),
      makePlan({ variantId: 'v2', texts: { headline: 'Concept B', cta: 'Buy' } }),
    ]);

    // Both plans start selected — deselect v2 so only v1 is accepted.
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByText('Accept plan'));

    expect(onAcceptPlan).toHaveBeenCalledWith('msg-1', 'v1', {
      v1: { headline: 'Concept A', cta: 'Buy' },
    });
  });

  it('renders old plan messages without texts and accepts without a texts payload', () => {
    const onAcceptPlan = renderPlan([makePlan()]);

    // No crash; inputs render blank from the missing texts.
    expect(screen.getAllByRole('textbox')).toHaveLength(2);

    fireEvent.click(screen.getByText('Accept plan'));

    // All values blank → no stale empty texts are sent.
    expect(onAcceptPlan).toHaveBeenCalledWith('msg-1', 'v1', undefined);
  });

  it('More ideas asks for a fresh set of concepts without a hardcoded count', () => {
    const onRevisePlan = vi.fn();
    render(
      <MessageRenderer
        message={planMessage([makePlan()])}
        onAcceptPlan={vi.fn()}
        onRevisePlan={onRevisePlan}
        onFormSubmit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('More ideas'));

    const instruction = onRevisePlan.mock.calls[0][0] as string;
    expect(instruction).toContain('deliberately different');
    expect(instruction).not.toMatch(/\d/);
  });
});

describe('PlanMessage multi-line copy', () => {
  // getByDisplayValue matches a textarea's textContent, not its value, so
  // controlled textareas are queried from the container instead.
  const renderPlanWithDom = (plans: DesignPlan[]) => {
    const onAcceptPlan = vi.fn();
    const { container } = render(
      <MessageRenderer
        message={planMessage(plans)}
        onAcceptPlan={onAcceptPlan}
        onRevisePlan={vi.fn()}
        onFormSubmit={vi.fn()}
      />
    );
    return { container, onAcceptPlan };
  };

  const textareasOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[];

  const textInputsOf = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll('input:not([type="checkbox"])')
    ) as HTMLInputElement[];

  it('renders \\n values and caption roles as textareas, other slots as inputs', () => {
    const { container } = renderPlanWithDom([
      makePlan({
        slots: [
          { id: 'top-caption', role: 'top-caption', kind: 'text' },
          { id: 'bottom-caption', role: 'bottom-caption', kind: 'text' },
          { id: 'headline', role: 'headline', kind: 'text' },
        ],
        texts: {
          'top-caption': 'MONDAY MORNING\nI JUST OPENED THE IDE',
          'bottom-caption': 'ship it',
          headline: 'Standup Notes',
        },
      }),
    ]);

    // The two-line meme caption keeps its line break in a textarea; caption
    // roles are multi-line even without a newline in the copy.
    expect(textareasOf(container).map((el) => el.value)).toEqual([
      'MONDAY MORNING\nI JUST OPENED THE IDE',
      'ship it',
    ]);
    // Single-line slots keep the single-line Input.
    expect(textInputsOf(container).map((el) => el.value)).toEqual([
      'Standup Notes',
    ]);
  });

  it('flows an edited newline from the textarea into the accept payload', () => {
    const { container, onAcceptPlan } = renderPlanWithDom([
      makePlan({
        slots: [
          { id: 'top-caption', role: 'top-caption', kind: 'text' },
          { id: 'cta', role: 'cta', kind: 'cta-button' },
        ],
        texts: {
          'top-caption': 'MONDAY MORNING\nI JUST OPENED THE IDE',
          cta: 'Shop Now',
        },
      }),
    ]);

    fireEvent.change(container.querySelector('textarea')!, {
      target: { value: 'MONDAY MORNING\nSTILL DEBUGGING' },
    });
    fireEvent.click(screen.getByText('Accept plan'));

    expect(onAcceptPlan).toHaveBeenCalledWith('msg-1', 'v1', {
      v1: { 'top-caption': 'MONDAY MORNING\nSTILL DEBUGGING', cta: 'Shop Now' },
    });
  });
});

describe('MediaMessage Edit in Designer', () => {
  const mediaMessage = (
    items: Record<string, unknown>[]
  ): AiDesignerMessagePayload =>
    ({
      id: 'msg-1',
      seq: 1,
      sessionId: 'session-1',
      role: 'assistant',
      agent: 'composer',
      kind: 'media',
      content: { kind: 'media', items },
      createdAt: new Date().toISOString(),
    }) as AiDesignerMessagePayload;

  const renderMedia = (items: Record<string, unknown>[]) =>
    render(
      <MessageRenderer
        message={mediaMessage(items)}
        onAcceptPlan={vi.fn()}
        onRevisePlan={vi.fn()}
        onFormSubmit={vi.fn()}
      />
    );

  const item = {
    url: 'https://cdn.test/preview.png',
    type: 'image',
    caption: 'Variant 1 · ig-post',
    designId: 'design-1',
    fileId: 'file-1',
  };

  beforeEach(() => openModalMock.mockClear());

  it('renders an Edit in Designer button (no designer link)', () => {
    const { container } = renderMedia([item]);

    expect(
      screen.getByRole('button', { name: 'Edit in Designer' })
    ).toBeTruthy();
    expect(container.querySelector('a[href*="/media/designer"]')).toBeNull();
  });

  it('opens the designer in a full-screen modal with the design loaded', () => {
    renderMedia([item]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit in Designer' }));

    expect(openModalMock).toHaveBeenCalledTimes(1);
    const call = openModalMock.mock.calls[0][0];
    expect(call.fullScreen).toBe(true);
    // The children render prop mounts the Designer with the design id.
    const { getByTestId } = render(<>{call.children(vi.fn())}</>);
    expect(getByTestId('designer-stub').getAttribute('data-design-id')).toBe(
      'design-1'
    );
  });

  it('lightbox Edit in Designer closes the lightbox and opens the designer modal', () => {
    renderMedia([item]);

    // Open the lightbox via the thumbnail.
    fireEvent.click(screen.getByRole('button', { name: 'View full size' }));
    const lightboxCall = openModalMock.mock.calls[0][0];
    const lightboxClose = vi.fn();
    const { container } = render(<>{lightboxCall.children(lightboxClose)}</>);

    openModalMock.mockClear();
    fireEvent.click(
      within(container).getByRole('button', { name: 'Edit in Designer' })
    );

    expect(lightboxClose).toHaveBeenCalledTimes(1);
    expect(openModalMock).toHaveBeenCalledTimes(1);
    expect(openModalMock.mock.calls[0][0].fullScreen).toBe(true);
  });
});
