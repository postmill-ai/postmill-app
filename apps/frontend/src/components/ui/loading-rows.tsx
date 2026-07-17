'use client';

import React, { FC } from 'react';
import clsx from 'clsx';

interface LoadingRowsProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export const LoadingRows: FC<LoadingRowsProps> = ({ rows = 3, columns = 4, className }) => {
  return (
    <div className={clsx('animate-pulse flex flex-col gap-[8px]', className)}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-[12px]">
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="h-[16px] bg-newTableHeader rounded-[4px] flex-1"
              style={{ opacity: 1 - (c * 0.1) }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
