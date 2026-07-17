'use client';

import { FileManager } from '@gitroom/frontend/components/files/file-manager';

export const MediaLayoutComponent = () => {
  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px]">
      <FileManager standalone />
    </div>
  );
};
