'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { SafeContent } from '@postmill-ai/frontend/components/shared/safe-content';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { TranslatedLabel } from '@postmill-ai/react/translation/translated-label';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { Disclosure } from '@postmill-ai/frontend/components/ui/disclosure';
import { InteractiveForm } from './interactive-form';
import { markdownToHtml } from './markdown-lite';
import { getStylePreset } from '@postmill-ai/nestjs-libraries/ai-designer/styles';
import { isCopySlot } from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.types';
import type {
  AiDesignerMessagePayload,
  AiDesignerMsgContent,
  DesignPlan,
} from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.types';

// Lazy like the designer route — keeps Konva out of the chat's initial bundle.
const Designer = dynamic(
  () =>
    import('@postmill-ai/frontend/components/media-tools/designer/designer').then(
      (m) => m.Designer
    ),
  { ssr: false }
);

type MediaItem = Extract<AiDesignerMsgContent, { kind: 'media' }>['items'][number];

/** Opens the full Designer in a modal with the design loaded — same modal
 *  parameters as the files library's media editor (file.component.tsx). */
const openDesignerModal = (
  modal: ReturnType<typeof useModals>,
  t: ReturnType<typeof useT>,
  designId: string
) => {
  modal.openModal({
    title: t('edit_in_designer', 'Edit in Designer'),
    askClose: false,
    closeOnEscape: true,
    fullScreen: true,
    size: 'calc(100% - 80px)',
    height: 'calc(100% - 80px)',
    children: (close: () => void) => (
      <Designer designId={designId} closeModal={close} />
    ),
  });
};

/** Edited plan copy: variantId → slotId → text. */
export type PlanTextsPayload = Record<string, Record<string, string>>;

interface MessageRendererProps {
  message: AiDesignerMessagePayload;
  onAcceptPlan: (
    replyTo: string,
    variantId?: string,
    texts?: PlanTextsPayload
  ) => void;
  onRevisePlan: (instruction: string, targetDesignId?: string) => void;
  onFormSubmit: (replyTo: string, values: Record<string, unknown>) => void;
}

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  message,
  onAcceptPlan,
  onRevisePlan,
  onFormSubmit,
}) => {
  const { content } = message;
  const t = useT();

  switch (content.kind) {
    case 'text':
      return <TextMessage content={content.text} />;
    case 'markdown':
      return <MarkdownMessage md={content.md} />;
    case 'media':
      return <MediaMessage items={content.items} />;
    case 'progress':
      return <ProgressMessage content={content} />;
    case 'plan':
      return (
        <PlanMessage
          content={content}
          replyTo={message.id}
          onAccept={onAcceptPlan}
          onRevise={onRevisePlan}
        />
      );
    case 'form':
      return (
        <InteractiveForm
          prompt={content.prompt}
          fields={content.fields}
          replyTo={message.id}
          submitLabel={content.submitLabel}
          onSubmit={onFormSubmit}
        />
      );
    default:
      return (
        <div className="text-[13px] text-textColor/60">
          {t('unknown_message_kind', 'Unknown message kind')}
        </div>
      );
  }
};

const TextMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="text-[14px] text-textColor whitespace-pre-wrap">{content}</div>
);

const MarkdownMessage: React.FC<{ md: string }> = ({ md }) => {
  const html = useMemo(() => markdownToHtml(md), [md]);
  return (
    <SafeContent
      content={html}
      className="text-[14px] text-textColor max-w-none space-y-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-5 [&_ol]:ps-5 [&_code]:text-[13px] [&_code]:bg-boxHover [&_code]:rounded-sm [&_code]:px-1 [&_a]:text-btnPrimaryAccent [&_a]:underline"
    />
  );
};

const MediaMessage: React.FC<{
  items: Extract<AiDesignerMsgContent, { kind: 'media' }>['items'];
}> = ({ items }) => {
  const t = useT();
  const modal = useModals();

  const openLightbox = (item: MediaItem) => {
    modal.openModal({
      title: item.caption || t('preview', 'Preview'),
      closeOnClickOutside: true,
      closeOnEscape: true,
      withCloseButton: true,
      classNames: { modal: 'w-[100%] max-w-[900px] text-textColor' },
      children: (close) => <MediaLightbox item={item} close={close} />,
      size: 'lg',
    });
  };

  // Finished results group by design — one card per design with a single
  // Edit button (a design's channel variants are the SAME design re-fitted,
  // so per-image edit links all opened the same thing). In-flight previews
  // carry no designId yet and stay ungrouped tiles without a button.
  const { groups, ungrouped } = useMemo(() => {
    const byDesign = new Map<string, MediaItem[]>();
    const loose: MediaItem[] = [];
    for (const item of items) {
      if (!item.designId) {
        loose.push(item);
        continue;
      }
      byDesign.set(item.designId, [...(byDesign.get(item.designId) ?? []), item]);
    }
    return { groups: [...byDesign.entries()], ungrouped: loose };
  }, [items]);

  const tile = (item: MediaItem, idx: number) => (
    <div key={`${item.fileId || item.url}-${idx}`} className="flex flex-col gap-1">
      {item.type === 'video' ? (
        <video
          src={item.url}
          controls
          className="max-w-[280px] max-h-[200px] rounded-lg border border-studioBorder"
        >
          <track kind="captions" src="" label={t('no_captions', 'No captions')} />
        </video>
      ) : (
        <button
          type="button"
          onClick={() => openLightbox(item)}
          className="cursor-zoom-in rounded-lg ring-designerAccent hover:ring-2 transition-shadow"
          aria-label={t('view_full_size', 'View full size')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.url}
            alt={item.caption || t('preview', 'Preview')}
            className="max-w-[280px] max-h-[200px] rounded-lg border border-studioBorder object-contain"
          />
        </button>
      )}
      {item.caption && (
        <span className="text-[11px] text-textColor/60">{item.caption}</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([designId, groupItems]) => {
        // 'Variant 1 · ig-post' → 'Variant 1'
        const title = groupItems[0].caption?.split(' · ')[0];
        return (
          <div
            key={designId}
            className="flex flex-col items-start gap-2 rounded-lg border border-studioBorder bg-newBgColorInner p-3"
          >
            {title && (
              <div className="text-[13px] font-medium text-textColor">{title}</div>
            )}
            <div className="flex flex-wrap gap-3">{groupItems.map(tile)}</div>
            <Button
              type="button"
              onClick={() => openDesignerModal(modal, t, designId)}
            >
              {t('edit_in_designer', 'Edit in Designer')}
            </Button>
          </div>
        );
      })}
      {ungrouped.length > 0 && (
        <div className="flex flex-wrap gap-3">{ungrouped.map(tile)}</div>
      )}
    </div>
  );
};

const MediaLightbox: React.FC<{
  item: MediaItem;
  close: () => void;
}> = ({ item, close }) => {
  const t = useT();
  const modal = useModals();
  return (
    <div className="flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.url}
        alt={item.caption || t('preview', 'Preview')}
        className="max-w-full max-h-[75vh] rounded-lg object-contain"
      />
      {item.caption && (
        <div className="text-[13px] text-textColor/70">{item.caption}</div>
      )}
      {item.designId && (
        <Button
          type="button"
          onClick={() => {
            close();
            openDesignerModal(modal, t, item.designId!);
          }}
        >
          {t('edit_in_designer', 'Edit in Designer')}
        </Button>
      )}
    </div>
  );
};

const ProgressMessage: React.FC<{
  content: Extract<AiDesignerMsgContent, { kind: 'progress' }>;
}> = ({ content }) => {
  const pct =
    typeof content.pct === 'number' ? Math.max(0, Math.min(100, content.pct)) : null;
  // No percentage — the agent is thinking, not measuring. Thinking shows the
  // indicator alone: no agent name, no phase text, no container. Anything more
  // reads as a message the user is meant to keep.
  if (pct === null) return <TypingIndicator />;

  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      <div className="flex items-center justify-between text-[12px] text-textColor/80">
        <span className="font-medium">{content.agent}</span>
        <span className="text-textColor/50">{content.phase}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-studioBorder overflow-hidden">
        <div
          className="h-full bg-designerAccent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {content.note && (
        <div className="text-[12px] text-textColor/60">{content.note}</div>
      )}
    </div>
  );
};

/**
 * Animated "agent is thinking" indicator.
 *
 * The asset's viewBox is cropped to the dots' animated bounds, so height alone
 * controls their size — the original 280×160 box was ~2/3 empty padding, which
 * is why this used to render at ~3px per dot.
 */
export const TypingIndicator: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center gap-2">
    {/* eslint-disable-next-line @next/next/no-img-element -- local animated SVG */}
    <img
      src="/ai-designer/loading.svg"
      alt=""
      aria-hidden="true"
      className="h-[32px] w-auto"
    />
    {label && (
      <span className="text-[12px] text-textColor/60">{label}</span>
    )}
  </div>
);

const MORE_IDEAS_INSTRUCTION =
  'Sketch a fresh set of concept directions, deliberately different from the current set.';

/** 'hero-top' → 'Hero Top' */
const humanize = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Slot roles that naturally hold multi-line copy (e.g. meme captions). */
const CAPTION_ROLES = new Set(['top-caption', 'bottom-caption', 'caption']);

/**
 * Copy slots edit in a multi-line field when the copy already carries a line
 * break (meme plans produce two-line captions) or the role is a caption.
 */
const isMultilineSlot = (role: string, value: string) =>
  value.includes('\n') || CAPTION_ROLES.has(role);

/**
 * Read a plan's slot copy defensively: `DesignPlan.texts` (slotId → copy)
 * lands with the backend plan-time-copy change, and plan messages persisted
 * before it carry no texts at all.
 */
const planTexts = (plan: DesignPlan): Record<string, string> =>
  (plan as DesignPlan & { texts?: Record<string, string> }).texts ?? {};

const PlanMessage: React.FC<{
  content: Extract<AiDesignerMsgContent, { kind: 'plan' }>;
  replyTo: string;
  onAccept: (replyTo: string, variantId?: string, texts?: PlanTextsPayload) => void;
  onRevise: (instruction: string, targetDesignId?: string) => void;
}> = ({ content, replyTo, onAccept, onRevise }) => {
  const t = useT();
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState('');
  // Multi-select: every plan starts selected. Accepting with exactly one
  // selected sends that variantId; with more (or all) selected it accepts
  // the whole plan set (no variantId — the conductor runs every plan).
  const [selectedIds, setSelectedIds] = useState<string[]>(
    content.plans.map((p) => p.variantId)
  );
  // Accordion state: every card starts collapsed. Collapsing unmounts a
  // card's copy editors, but their values live in `editedTexts` below, so
  // edits survive a collapse and still ship with Accept.
  const [openIds, setOpenIds] = useState<string[]>([]);
  // Inline copy editing: one input per copy slot, initialized from the
  // plan's texts ('' when the plan predates plan-time copy).
  const [editedTexts, setEditedTexts] = useState<PlanTextsPayload>(() => {
    const init: PlanTextsPayload = {};
    for (const plan of content.plans) {
      const copySlots = plan.slots.filter(isCopySlot);
      if (copySlots.length === 0) continue;
      const texts = planTexts(plan);
      init[plan.variantId] = Object.fromEntries(
        copySlots.map((slot) => [slot.id, texts[slot.id] ?? ''])
      );
    }
    return init;
  });

  const canAccept = content.actions.includes('accept');
  const canRevise = content.actions.includes('revise');

  const togglePlan = (variantId: string) =>
    setSelectedIds((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );

  const toggleOpen = (variantId: string) =>
    setOpenIds((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );

  const setSlotText = (variantId: string, slotId: string, value: string) =>
    setEditedTexts((prev) => ({
      ...prev,
      [variantId]: { ...prev[variantId], [slotId]: value },
    }));

  // Edited copy for the selected plans only. Blank values are dropped so an
  // untouched plan (e.g. one persisted before plan-time copy) never locks
  // empty text in at execution.
  const textsForSelected = (): PlanTextsPayload | undefined => {
    const out: PlanTextsPayload = {};
    for (const plan of content.plans) {
      if (!selectedIds.includes(plan.variantId)) continue;
      const slots = editedTexts[plan.variantId];
      if (!slots) continue;
      const entries = Object.entries(slots).filter(([, value]) => value.trim());
      if (entries.length > 0) {
        out[plan.variantId] = Object.fromEntries(entries);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[14px] text-textColor">
        <strong className="font-medium">{t('intent_colon', 'Intent:')}</strong>{' '}
        {content.brief.intent}
      </div>
      {content.plans.length > 0 && (
        <div className="flex flex-col gap-2">
          {content.plans.map((plan) => {
            const styleTitle = plan.styleId
              ? getStylePreset(plan.styleId)?.title
              : undefined;
            const copySlots = plan.slots.filter(isCopySlot);
            return (
              <div
                key={plan.variantId}
                className={`rounded-lg border p-3 transition-colors ${
                  selectedIds.includes(plan.variantId)
                    ? 'border-designerAccent bg-designerAccent/10'
                    : 'border-studioBorder bg-newBgColorInner'
                }`}
              >
                <Disclosure
                  open={openIds.includes(plan.variantId)}
                  onToggle={() => toggleOpen(plan.variantId)}
                  header={
                    <div className="flex items-start gap-3">
                      {/* The label swallows the click so toggling selection
                          never expands/collapses the card. */}
                      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
                      <label
                        className="flex cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          value={plan.variantId}
                          checked={selectedIds.includes(plan.variantId)}
                          onChange={() => togglePlan(plan.variantId)}
                          className="mt-0.5 accent-designerAccent"
                        />
                        <span className="sr-only">{plan.concept}</span>
                      </label>
                      <div className="min-w-0 text-[13px] font-medium text-textColor">
                        {plan.concept}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-normal text-textColor/60">
                          {styleTitle && (
                            <span className="px-1.5 py-0.5 rounded-sm bg-designerAccent/15 text-[10px] font-medium text-textColor">
                              {styleTitle}
                            </span>
                          )}
                          {plan.slots.length > 0 && (
                            <span>
                              {t('n_slots_count', '{{count}} slot', {
                                count: plan.slots.length,
                              })}
                            </span>
                          )}
                          {plan.formatTemplate && (
                            <span>{humanize(plan.formatTemplate)}</span>
                          )}
                          {plan.palette.length > 0 && (
                            <span className="flex items-center gap-1">
                              {plan.palette.slice(0, 6).map((color) => (
                                <span
                                  key={color}
                                  className="w-3 h-3 rounded-full border border-studioBorder"
                                  style={{ backgroundColor: color }}
                                  title={color}
                                />
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  }
                >
                  {canAccept && copySlots.length > 0 && (
                    // Outside the selection label so focusing an input never
                    // toggles the plan checkbox.
                    <div className="mt-2 flex flex-col gap-2 ps-[28px]">
                      {copySlots.map((slot) => {
                        const value =
                          editedTexts[plan.variantId]?.[slot.id] ?? '';
                        if (isMultilineSlot(slot.role, value)) {
                          // Multi-line copy edits in an auto-height textarea
                          // styled like the revise box; the label mirrors the
                          // Input's own label markup.
                          return (
                            <div key={slot.id} className="flex flex-col gap-[6px]">
                              <div className="text-[14px]">
                                <TranslatedLabel label={humanize(slot.role)} />
                              </div>
                              <textarea
                                name={`plan-text-${plan.variantId}-${slot.id}`}
                                maxLength={500}
                                value={value}
                                rows={Math.max(
                                  2,
                                  Math.min(6, value.split('\n').length + 1)
                                )}
                                onChange={(e) =>
                                  setSlotText(
                                    plan.variantId,
                                    slot.id,
                                    e.target.value
                                  )
                                }
                                className="rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-[14px] text-textColor outline-hidden focus:border-designerAccent resize-none"
                              />
                            </div>
                          );
                        }
                        return (
                          <Input
                            key={slot.id}
                            disableForm
                            removeError
                            name={`plan-text-${plan.variantId}-${slot.id}`}
                            label={humanize(slot.role)}
                            maxLength={500}
                            value={value}
                            onChange={(e) =>
                              setSlotText(plan.variantId, slot.id, e.target.value)
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </Disclosure>
              </div>
            );
          })}
        </div>
      )}

      {canAccept && selectedIds.length > 1 && (
        <div className="text-[12px] text-textColor/60">
          {t(
            'all_plans_will_be_generated',
            'All plans will be generated — select exactly one to generate only that variant.'
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {canAccept && (
          <Button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() =>
              onAccept(
                replyTo,
                selectedIds.length === 1 ? selectedIds[0] : undefined,
                textsForSelected()
              )
            }
          >
            {selectedIds.length === 1
              ? t('accept_plan', 'Accept plan')
              : t('accept_plans', 'Accept plans')}
          </Button>
        )}
        {canRevise && (
          <Button
            type="button"
            secondary
            onClick={() => setReviseOpen((v) => !v)}
          >
            {t('revise', 'Revise')}
          </Button>
        )}
        {canRevise && (
          <Button
            type="button"
            secondary
            onClick={() => onRevise(MORE_IDEAS_INSTRUCTION)}
          >
            {t('more_ideas', 'More ideas')}
          </Button>
        )}
      </div>

      {reviseOpen && (
        <div className="flex flex-col gap-2">
          <textarea
            value={reviseText}
            onChange={(e) => setReviseText(e.target.value)}
            placeholder={t('what_would_you_like_to_change', 'What would you like to change?')}
            className="min-h-[80px] rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-[14px] text-textColor outline-hidden focus:border-designerAccent resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              secondary
              onClick={() => {
                setReviseOpen(false);
                setReviseText('');
              }}
            >
              {t('cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!reviseText.trim()) return;
                onRevise(reviseText.trim());
                setReviseOpen(false);
                setReviseText('');
              }}
            >
              {t('send_revision', 'Send revision')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
