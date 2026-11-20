'use client';

import React, { FC, ReactNode } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface AiToolCardProps {
  id: string;
  title: string;
  description: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export const AiToolCard: FC<AiToolCardProps> = ({
  id,
  title,
  description,
  expanded,
  onToggle,
  children,
}) => (
  <section className="rounded-md border border-studioBorder bg-newBgColorInner overflow-hidden">
    <h4>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? `ai-tool-${id}` : undefined}
        onClick={onToggle}
        className="w-full min-h-[40px] flex items-center justify-between gap-2 px-3 py-2 text-start text-[12px] font-medium text-textColor hover:bg-boxHover"
      >
        <span>{title}</span>
        <span aria-hidden className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
      </button>
    </h4>
    {expanded && (
      <div id={`ai-tool-${id}`} role="region" aria-label={title} className="px-3 pb-3 space-y-3 border-t border-studioBorder">
        <p className="pt-2 text-[11px] leading-relaxed text-textColor/50">{description}</p>
        {children}
      </div>
    )}
  </section>
);

export const AiGenerateButton: FC<{
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ busy = false, disabled = false, onClick }) => {
  const t = useT();
  return (
    <button
      type="button"
      className="w-full min-h-[36px] px-3 py-2 bg-designerAccent/10 hover:bg-designerAccent/20 disabled:opacity-50 text-[12px] font-medium text-btnPrimaryAccent rounded-sm border border-designerAccent/30"
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? t('designer_generating_ellipsis', 'Generating…') : t('generate', 'Generate')}
    </button>
  );
};
