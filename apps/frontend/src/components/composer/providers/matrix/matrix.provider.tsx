'use client';

import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';

// Matrix room messages have no comment/reply flow wired up, so there are no
// per-post settings.
export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: undefined,
  // No spec cap; 10000 stays well inside mainstream homeserver event-size
  // limits (matches the adapter's maxLength).
  maximumCharacters: 10000,
});
