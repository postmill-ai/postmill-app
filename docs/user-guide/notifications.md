# Notifications

Postmill routes every user-facing notification through a single notification service. The UI surfaces are the in-app bell, the per-user preference panel, and the admin broadcast page.

## In-app notification bell

The bell in the top navigation shows your unread count for the current organisation (`GET /notifications`). Opening the bell loads the full list (`GET /notifications/list`) and lets you:

- mark a single item as read (`PATCH /notifications/:id/read`)
- mark everything as read (`POST /notifications/read-all`)
- delete an item (`DELETE /notifications/:id`)

In-app notifications are always available; they do not depend on any external provider.

## Notification channels

There are three delivery channels. The **master toggles** in the Notifications panel turn a channel off entirely for your account.

| Channel | Requirements | Notes |
|---------|--------------|-------|
| **Email** | An email provider must be configured by the operator (SMTP, Postmark, etc.) | Digest-eligible items can be batched by digest frequency. |
| **Push** | Firebase Cloud Messaging credentials (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`) | Push tokens are registered from a mobile app or PWA. |
| **In-app** | None | Always available; appears in the bell. |

## Notification categories

Each category can be enabled or disabled per channel. The defaults are:

| Category | Email | Push | In-app | Typical trigger |
|----------|-------|------|--------|-----------------|
| **Post published** | on | off | on | A scheduled post goes live. |
| **Post failed** | on | on | on | A post or a sub-step (first comment, etc.) fails. |
| **Channel issues** | on | on | on | A channel needs reconnecting or is disabled. |
| **Replies** | on | off | on | New synced comments or a comment backlog digest. |
| **AI budget** | on | off | on | AI spend reaches a percentage of the budget cap. |
| **Media jobs** | off | off | on | A media render, transcription, or stock import finishes. |
| **Announcements** | on | off | on | An admin broadcasts a message to the organisation. |
| **Streak reminders** | on | off | on | Your posting streak is about to expire. |
| **Agent briefs** | off | off | off | Weekly proactive agent digest (opt-in). |
| **Analytics alerts** | on | off | on | Anomaly spike/drop or the weekly summary. |

The category list is enforced by the API and the preference panel. A stale frontend sending an unknown category is silently merged; unknown categories fall back to the master channel toggle.

## Digest frequency

For digest-eligible categories, email delivery respects your per-user digest frequency:

- **Instant** (default) — send immediately.
- **Daily** — queue for the next daily digest.
- **Weekly** — queue for the next weekly digest.
- **Never** — skip digest emails entirely.

Digest queues are stored per organisation and user. Choosing **Never** does not disable real-time email for categories that are not marked digest-eligible.

## Push tokens

Clients register push tokens with `POST /notifications/push-tokens`, supplying the token, platform, and optional device name. Tokens are unique across users; reassignment to a different user is rejected. Invalid tokens are automatically deactivated after a failed FCM send.

## Admin broadcasts

Users with the `notifications:manage` permission can open **Settings → Broadcast** and send an announcement to the organisation. A broadcast can target:

- all organisation members, or
- a subset by role, or
- an explicit list of user IDs (up to 1,000),

and can choose which channels to use. Broadcasts are category `announcements` and override user category toggles, but they still respect the master channel toggles.

## Transactional emails bypass preferences

A small set of single-recipient emails is sent regardless of notification preferences: account activation, password reset, team invitations, and billing cancellation notices. These are transactional and do not create in-app rows.

## Where to configure notifications

- **Personal preferences:** avatar menu → **Profile** → **Notifications** tab.
- **Broadcasts:** **Settings** → **Broadcast** (admin/owner only).

> See also [Team & Roles](./team-and-roles.md) for broadcast permissions, [Settings](./settings.md) for the settings layout, and [Operations Guide → Configuration](../operations-guide/configuration.md) for email and FCM environment variables.

> Verified against v1.0.0
