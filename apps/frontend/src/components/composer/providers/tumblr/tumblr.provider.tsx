'use client';
import { withProvider, PostComment } from
  '@gitroom/frontend/components/composer/providers/high.order.provider';

export default withProvider({
  comments: false,
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 4096,
});
