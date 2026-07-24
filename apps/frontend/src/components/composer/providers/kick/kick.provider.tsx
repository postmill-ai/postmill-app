'use client';

import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { FirstCommentField } from '@postmill-ai/frontend/components/composer/providers/shared/first-comment.field';

const KickSettings = () => {
  return (
    <>
      <FirstCommentField />
    </>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  comments: 'no-media',
  minimumCharacters: [],
  SettingsComponent: KickSettings,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 500,
});
