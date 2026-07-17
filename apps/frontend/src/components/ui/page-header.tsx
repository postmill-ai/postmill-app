import React, { FC, ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export const PageHeader: FC<PageHeaderProps> = ({ title, description, action }) => {
  return (
    <div className="flex items-center justify-between mb-[20px]">
      <div>
        <h1 className="text-[20px] mobile:text-[24px] font-[600] text-textColor">{title}</h1>
        {description && (
          <p className="text-[13px] text-newTableText mt-[4px]">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex items-center gap-[8px]">{action}</div>
      )}
    </div>
  );
};
