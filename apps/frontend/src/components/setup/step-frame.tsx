'use client';

import React, { ReactNode } from 'react';

export interface StepFrameProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function StepFrame({ title, subtitle, children }: StepFrameProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-[24px] pt-[24px] pb-[16px]">
        <h2 className="text-[20px] font-[600] text-textColor">{title}</h2>
        {subtitle && (
          <p className="text-[13px] text-newTableText mt-[4px] max-w-[640px]">
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-[24px] pb-[24px]">
        {children}
      </div>
    </div>
  );
}
