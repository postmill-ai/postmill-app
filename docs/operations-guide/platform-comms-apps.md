# Platform Comms Apps

**Comms channels** (Slack, Telegram, Discord, Matrix, LINE) are Postmill's
chat surface: org members talk to the Postmill agent in a DM or channel, and
Postmill delivers notifications (post published, post failed, …) to the
connected chat.

Every comms provider can be connected two ways:

1. **Platform app (default, this page)** — the operator sets the Postmill
   platform app's credentials in the deployment environment (`.env` / Docker
   Compose). Every organization then connects with one click ("Use the
   Postmill app", or "Connect with Slack" OAuth). The comms side **reuses the
   same platform apps already configured for posting channels** — see
   [Platform Channel Apps](./platform-channel-apps.md); no new vendor apps are
   needed, only a few extra values and scopes.
2. **Advanced (own app)** — collapsed in the connect dialog; the org creates
   its own bot/app and pastes its credentials, exactly like the manual per-org
   flow. See [Own app (Advanced)](#own-app-advanced).

Unlike posting channels, where each org connects its own accounts, ONE
platform app/bot serves ALL organizations on comms. Postmill routes inbound
messages to the right org: Slack by workspace `team_id`, Discord by guild,
Telegram and LINE by the linked user (one-time connect code).

## Webhook URLs and restarts

Provider webhooks always point at the public backend:

```
https://<backend>/webhooks/comms/platform/<provider>
```

(e.g. `https://postmill.example.com/api/webhooks/comms/platform/slack`).
**Prerequisite:** `NEXT_PUBLIC_BACKEND_URL` must be the public backend URL
that the providers can reach — Slack, Discord, and LINE push events to
webhooks under it. Telegram's webhook auto-registers on connect; Matrix needs
no webhook at all (Postmill polls).

Comms env vars enter `process.env` when the **backend boots** — restart the
backend after editing `.env`.

## Slack

Comms reuses the Postmill Slack app from [Platform Channel Apps →
Slack](./platform-channel-apps.md#slack) — `SLACK_ID` / `SLACK_SECRET` are
already set. Chat additionally needs DM scopes, event subscriptions, and the
app's Signing Secret.

1. Open [Slack API: Your Apps](https://api.slack.com/apps) and pick the
   Postmill app.
2. Under **OAuth & Permissions → Bot Token Scopes**, add `chat:write`,
   `im:write`, `im:history`, `app_mentions:read` (keep the existing posting
   scopes).
3. Under **Event Subscriptions**, enable events, set the **Request URL** to
   `https://<backend>/webhooks/comms/platform/slack`, and under **Subscribe to
   bot events** add `message.im`.
4. Under **Basic Information**, copy the **Signing Secret**:

```yaml
SLACK_SIGNING_SECRET: '<your-signing-secret>'   # NEW for comms
```

5. Restart the backend.

**Org flow:** the org clicks **Connect with Slack** and installs the app into
their workspace via OAuth — one Slack workspace per org. Inbound messages are
routed to the org by the workspace's `team_id`. For workspaces other than the
app's own, **Manage Distribution → Activate Public Distribution** must be
enabled on the Slack app (same requirement as posting channels).

## Discord

Comms reuses the Postmill Discord application and bot from [Platform Channel
Apps → Discord](./platform-channel-apps.md#discord) — `DISCORD_CLIENT_ID` /
`DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` are already set. Chat
additionally needs the app's Public Key and an Interactions Endpoint.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and pick the Postmill application.
2. Under **General Information**, copy the **Public Key**:

```yaml
DISCORD_PUBLIC_KEY: '<your-public-key>'   # NEW for comms
```

3. On the same page, set the **Interactions Endpoint URL** to
   `https://<backend>/webhooks/comms/platform/discord`.
4. Restart the backend.

**Org flow:** the org clicks **Use the Postmill app**. The platform bot must
be invited to their server — the same bot invite as for posting channels —
with write access to the target channel. Inbound messages are routed to the
org by guild.

## Telegram

Comms reuses the Postmill bot from [Platform Channel Apps →
Telegram](./platform-channel-apps.md#telegram): `TELEGRAM_TOKEN` is already
set and **nothing new is needed** — the bot webhook auto-registers to the
platform URL when an org connects.

**Org flow:** the org member clicks **Use the Postmill app**, copies their
one-time connect code from **Settings → Comms**, and sends it to the bot in a
DM. Postmill links that Telegram user to the org member; agent chat and
notifications land in the DM.

## LINE

Comms reuses the Messaging API channel from [Platform Channel Apps →
LINE](./platform-channel-apps.md#line) — `LINE_CHANNEL_ACCESS_TOKEN` is
already set. Chat additionally needs the channel secret for webhook signature
verification.

1. Open the [LINE Developers console](https://developers.line.biz/console/)
   and pick the Messaging API channel.
2. Under **Basic settings**, copy the **Channel secret**:

```yaml
LINE_CHANNEL_SECRET: '<your-channel-secret>'   # NEW for comms
```

3. On the **Messaging API** tab, set the **Webhook URL** to
   `https://<backend>/webhooks/comms/platform/line` and enable **Use
   webhook**.
4. Restart the backend.

**Org flow:** the org member clicks **Use the Postmill app**, adds the LINE
Official Account as a friend, and links it with the one-time connect code
from **Settings → Comms**.

## Matrix

There is **no Matrix platform app** — Matrix is always configured per org from
the Advanced section: the org provides a `homeserverUrl` and an `accessToken`
for a bot user on any Matrix homeserver. Postmill **polls** the homeserver
(no webhook), so no operator env vars or portal setup are involved.

To create the bot user and obtain an access token:

1. Pick the homeserver the bot will live on (any Matrix homeserver — e.g.
   matrix.org or your own).
2. Register a dedicated bot account on it (e.g. `@postmill-bot:example.org`).
3. Log in as the bot once with [Element](https://app.element.io/): sign in
   with the bot's credentials, then copy the token from **Settings → Help &
   About → Advanced → Access Token**.
4. In Postmill, open the Matrix comms connect dialog → **Advanced** and paste
   the **homeserver URL** (`https://matrix.example.org`) and the **access
   token**.

Keep the token secret — it grants full access to the bot account.

## Env var summary

The full comms credential set. Only the three marked **NEW** are in addition
to the posting-channel platform apps.

| Variable | Provider | Purpose | Where found |
|----------|----------|---------|-------------|
| `SLACK_ID` / `SLACK_SECRET` | Slack | OAuth install of the platform app (shared with posting channels) | api.slack.com → app → Basic Information |
| `SLACK_SIGNING_SECRET` **(NEW)** | Slack | Verifies inbound event-webhook signatures | api.slack.com → app → Basic Information |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord | OAuth identity (shared with posting channels) | discord.com/developers → app → OAuth2 |
| `DISCORD_BOT_TOKEN` | Discord | Bot token for agent replies and notifications (shared with posting channels) | discord.com/developers → app → Bot |
| `DISCORD_PUBLIC_KEY` **(NEW)** | Discord | Verifies inbound interaction-webhook signatures | discord.com/developers → app → General Information |
| `TELEGRAM_TOKEN` | Telegram | Bot token — the entire credential (shared with posting channels) | @BotFather |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE | Messaging API channel access token (shared with posting channels) | LINE Developers console → channel → Messaging API |
| `LINE_CHANNEL_SECRET` **(NEW)** | LINE | Verifies inbound webhook signatures | LINE Developers console → channel → Basic settings |
| — | Matrix | No platform env vars — per-org `homeserverUrl` + `accessToken` | any Matrix homeserver (see above) |

## Own app (Advanced)

Every provider can instead be configured **per org** with the org's own
bot/app from the Advanced section of the connect dialog. In that mode the
webhook URL shown in the dialog is **org-unique** and must be pasted into the
org's own app (Slack Event Subscriptions Request URL, Discord Interactions
Endpoint URL, LINE Webhook URL). A per-org config always wins over the
platform app. Matrix, having no platform app, is always configured this way.

## Related

- [Platform Channel Apps](./platform-channel-apps.md) — the posting-channel
  platform apps the comms apps reuse
- [Configuration](./configuration.md#channel-oauth-apps-platform-click-connect) — the full env var table

> Verified against v1.0.0
