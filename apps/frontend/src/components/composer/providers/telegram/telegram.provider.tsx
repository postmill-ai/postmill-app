'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';

const TelegramSettings = () => {
  return (
    <>
      <FirstCommentField />
    </>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TelegramSettings,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 4096,
});
