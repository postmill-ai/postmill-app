'use client';

import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';

// LINE broadcasts have no comment/reply concept, so there are no per-post
// settings (mirrors the telegram no-settings variant minus FirstComment).
export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: undefined,
  // LINE text message cap (Messaging API reference).
  maximumCharacters: 5000,
});
