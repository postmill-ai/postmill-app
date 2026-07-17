'use client';

import { FC } from 'react';
import { CommentInbox } from '@gitroom/frontend/components/comments/comment.inbox';

const RepliesPage: FC = () => {
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 p-[24px] mobile:p-[16px]">
      <CommentInbox />
    </div>
  );
};

export default RepliesPage;
