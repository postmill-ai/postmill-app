/**
 * Comms domain — bi-directional chat apps (Slack, Telegram, Discord, Matrix,
 * LINE, …) used for agent conversations and notification delivery to a linked
 * org user, as opposed to the `social` domain which publishes scheduled posts.
 *
 * Only `sendDirectMessage` is required; inbound transport differs per app
 * (signed webhooks vs long-poll) so every other method is optional and gated
 * by `CommsAdapterCapabilities`.
 */

export interface CommsInboundMessage {
  /**
   * 'message'   — a user-authored message to process.
   * 'challenge' — a transport handshake (Slack url_verification, Discord PING,
   *               Discord slash-command ack); respond with `ackResponse`, do
   *               not process further.
   * 'ignore'    — bot echoes / unsupported event types; drop silently.
   */
  kind: 'message' | 'challenge' | 'ignore';
  /** Sender identity: Slack user id, Telegram chat id, Discord user id, Matrix @user:hs, LINE user id. */
  externalUserId?: string;
  /** DM channel/room the message arrived in (Slack DM channel, Matrix room id, Discord channel id). */
  externalChannelId?: string;
  text?: string;
  /** Provider-unique message id — used for idempotent processing. */
  messageId?: string;
  /**
   * Body the webhook controller must return verbatim for this event (Slack
   * challenge echo, Discord `{"type":1}` pong or `{"type":4,...}` command ack).
   * A `message` kind may also carry one (Discord slash commands require an
   * interaction response within 3s while the reply is delivered via DM).
   */
  ackResponse?: unknown;
}

export interface CommsSendParams {
  externalUserId: string;
  /** Known DM channel/room id — lets the adapter skip re-opening the conversation. */
  externalChannelId?: string;
  text: string;
  /** Optional deep link back into Postmill, appended per-app. */
  link?: string;
}

export interface CommsSendResult {
  messageId?: string;
  /** DM channel/room id the message was sent in — callers persist it for reuse. */
  externalChannelId?: string;
}

export interface CommsPollResult {
  messages: CommsInboundMessage[];
  nextCursor?: string;
}

export interface CommsTestResult {
  ok: boolean;
  error?: string;
  /** Non-secret provider facts worth persisting (e.g. Slack team_id, bot username). */
  extra?: Record<string, string>;
}

export interface CommsAdapterCapabilities {
  /** Receives inbound events on the signed webhook endpoint. */
  webhookInbound: boolean;
  /** Inbound via cursor long-poll (`pollInbound`) instead of webhooks. */
  pollInbound: boolean;
  /** Replies can target a thread/channel distinct from the user id. */
  threads: boolean;
  /** The webhook URL is registered programmatically (`registerWebhook`). */
  webhookRegistration: boolean;
}

export interface CommsCapability {
  name: string;
  capabilities: CommsAdapterCapabilities;
  sendDirectMessage(params: CommsSendParams): Promise<CommsSendResult>;
  verifyWebhook?(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): boolean | Promise<boolean>;
  parseInbound?(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): CommsInboundMessage[];
  /** Point the provider's webhook at `webhookUrl`, guarded by `secret` (e.g. Telegram setWebhook). */
  registerWebhook?(webhookUrl: string, secret: string): Promise<void>;
  /** One-time provider-side setup beyond the webhook (e.g. Discord slash-command upsert). */
  provision?(): Promise<void>;
  /** Lightweight credential check (e.g. Slack auth.test, Telegram getMe). */
  testConnection?(): Promise<CommsTestResult>;
  /** Cursor long-poll for apps without webhooks (Matrix /sync). Null cursor = priming call. */
  pollInbound?(cursor?: string): Promise<CommsPollResult>;
  /** Best-effort display-name lookup for link-confirmation UX. */
  fetchIdentity?(externalUserId: string): Promise<{ displayName?: string }>;
}
