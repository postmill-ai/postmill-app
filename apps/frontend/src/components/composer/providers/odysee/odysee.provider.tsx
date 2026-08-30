'use client';
import { withProvider, PostComment } from
  '@postmill-ai/frontend/components/composer/providers/high.order.provider';

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 10000,
});
