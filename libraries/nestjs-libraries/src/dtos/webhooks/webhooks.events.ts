// Single source of truth for webhook event subscriptions — the DTO validators,
// WebhooksService.getSupportedEventTypes(), and the dispatch filters all read
// this list. The frontend keeps its own copy in webhooks.tsx EVENT_OPTIONS.
export const SUPPORTED_WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'comment.new',
  'comment.reply',
  'analytics.snapshot_complete',
  'analytics.anomaly_detected',
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];
