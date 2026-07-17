'use client';

import React, { FC, ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export const EmptyState: FC<EmptyStateProps> = ({ icon, title, description, action, className }) => {
  return (
    <div className={`bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[32px] flex flex-col items-center gap-[12px] text-center ${className || ''}`}>
      {icon && (
        <div className="text-newTableText/40">
          {icon}
        </div>
      )}
      <div className="text-[16px] font-[600] text-textColor">{title}</div>
      {description && (
        <div className="text-[13px] text-newTableText max-w-[320px]">{description}</div>
      )}
      {action && (
        <div className="mt-[8px]">{action}</div>
      )}
    </div>
  );
};
