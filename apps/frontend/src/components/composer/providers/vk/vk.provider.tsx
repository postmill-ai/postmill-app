'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';

const SettingsComponent = () => {
  return <FirstCommentField />;
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: SettingsComponent,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 2048,
});
