'use client';

import React, { useMemo, useState } from 'react';
import { SafeContent } from '@gitroom/frontend/components/shared/safe-content';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { InteractiveForm } from './interactive-form';
import { markdownToHtml } from './markdown-lite';
import type {
  AiDesignerMessagePayload,
  AiDesignerMsgContent,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

interface MessageRendererProps {
  message: AiDesignerMessagePayload;
  onAcceptPlan: (
    replyTo: string,
    variantId?: string,
    saveTemplate?: boolean
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
      className="text-[14px] text-textColor max-w-none space-y-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-5 [&_ol]:ps-5 [&_code]:text-[13px] [&_code]:bg-boxHover [&_code]:rounded [&_code]:px-1 [&_a]:text-btnPrimaryAccent [&_a]:underline"
    />
  );
};

const MediaMessage: React.FC<{
  items: Extract<AiDesignerMsgContent, { kind: 'media' }>['items'];
}> = ({ items }) => {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item, idx) => (
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt={item.caption || t('preview', 'Preview')}
              className="max-w-[280px] max-h-[200px] rounded-lg border border-studioBorder object-contain"
            />
          )}
          {item.caption && (
            <span className="text-[11px] text-textColor/60">{item.caption}</span>
          )}
          {item.designId && (
            <a
              href={`/media/designer?designId=${encodeURIComponent(item.designId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-btnPrimaryAccent hover:underline"
            >
              {t('open_in_designer', 'Open in Designer')}
            </a>
          )}
        </div>
      ))}
    </div>
  );
};

const ProgressMessage: React.FC<{
  content: Extract<AiDesignerMsgContent, { kind: 'progress' }>;
}> = ({ content }) => {
  const pct =
    typeof content.pct === 'number' ? Math.max(0, Math.min(100, content.pct)) : null;
  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      <div className="flex items-center justify-between text-[12px] text-textColor/80">
        <span className="font-medium">{content.agent}</span>
        <span className="text-textColor/50">{content.phase}</span>
      </div>
      {pct !== null && (
        <div className="h-2 w-full rounded-full bg-studioBorder overflow-hidden">
          <div
            className="h-full bg-designerAccent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {content.note && (
        <div className="text-[12px] text-textColor/60">{content.note}</div>
      )}
    </div>
  );
};

const PlanMessage: React.FC<{
  content: Extract<AiDesignerMsgContent, { kind: 'plan' }>;
  replyTo: string;
  onAccept: (replyTo: string, variantId?: string, saveTemplate?: boolean) => void;
  onRevise: (instruction: string, targetDesignId?: string) => void;
}> = ({ content, replyTo, onAccept, onRevise }) => {
  const t = useT();
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(
    content.plans[0]?.variantId
  );
  // Auto-save on accept (plan §10); unchecking is the "don't save" opt-out.
  const [saveTemplate, setSaveTemplate] = useState(true);

  const canAccept = content.actions.includes('accept');
  const canRevise = content.actions.includes('revise');

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[14px] text-textColor">
        <strong className="font-medium">{t('intent_colon', 'Intent:')}</strong>{' '}
        {content.brief.intent}
      </div>
      {content.plans.length > 0 && (
        <div className="flex flex-col gap-2">
          {content.plans.map((plan) => (
            <label
              key={plan.variantId}
              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                selectedVariantId === plan.variantId
                  ? 'border-designerAccent bg-designerAccent/10'
                  : 'border-studioBorder bg-newBgColorInner'
              }`}
            >
              <input
                type="radio"
                name={`variant-${replyTo}`}
                value={plan.variantId}
                checked={selectedVariantId === plan.variantId}
                onChange={() => setSelectedVariantId(plan.variantId)}
                className="accent-designerAccent"
              />
              <div>
                <div className="text-[13px] font-medium text-textColor">
                  {plan.concept}
                </div>
                {plan.slots.length > 0 && (
                  <div className="mt-1 text-[12px] text-textColor/60">
                    {t('n_slots_count', '{{count}} slot', {
                      count: plan.slots.length,
                    })}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {canAccept && (
        <label className="flex items-center gap-2 text-[13px] text-textColor cursor-pointer">
          <input
            type="checkbox"
            checked={saveTemplate}
            onChange={(e) => setSaveTemplate(e.target.checked)}
            className="accent-designerAccent"
          />
          {t('save_as_reusable_template', 'Save as reusable template')}
        </label>
      )}

      <div className="flex items-center gap-2">
        {canAccept && (
          <Button
            type="button"
            onClick={() => onAccept(replyTo, selectedVariantId, saveTemplate)}
          >
            {t('accept_plan', 'Accept plan')}
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
      </div>

      {reviseOpen && (
        <div className="flex flex-col gap-2">
          <textarea
            value={reviseText}
            onChange={(e) => setReviseText(e.target.value)}
            placeholder={t('what_would_you_like_to_change', 'What would you like to change?')}
            className="min-h-[80px] rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-[14px] text-textColor outline-none focus:border-designerAccent resize-none"
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
