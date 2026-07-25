---
name: send-notification
description: Send a user-facing notification (email, in-app, push) or add a notification category/digest in the Postmill monorepo. Use when sending a notification, wiring an email/in-app/push alert, choosing or adding a notification category, or touching digest batching.
---

# Send a Notification

Route every user-facing notification through `NotificationService.notify` — never `EmailService` directly.

## Read first
- `agents/notifications.md` — the full ruleset: chokepoint rule, `NotifyOptions`, the 10 categories, channel routing, digest, email/push internals.
- `agents/jobs.md` — only if the notification is scheduled/digest-driven (Inngest crons `digest-email-daily` / `digest-email-weekly`).

## Procedure

### Send from feature code
1. Inject `NotificationService` (`libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts`) via normal Controller → Service → (Manager) → Repository layering (`agents/backend.md`). Do NOT inject `EmailService` — the chokepoint applies per-user master/category toggles, digest batching, member filtering, and HTML escaping; bypassing it mails users who opted out.
2. Call `notify(options: NotifyOptions)` (notification.service.ts:105). Key fields: `orgId`, `category`, `title`, `message` (required); `link`, `metadata`, `channels` (caller cap merged over `{email,push,inApp}: true`), `digest`, `override`, `targetUserIds`, `html`. Detail: `agents/notifications.md` § `notify()` API.
   - Fan-out mechanics: members of `orgId` with disabled membership or `user.activated === false` are skipped; preferences are batch-loaded via `NotificationPreferenceService.ensureDefaultsForUsers`; a channel is enabled per member iff `channels[ch] && masters[ch] && categories[category][ch]` (`override: true` short-circuits; an unknown/legacy category gates on the master only); ONE shared in-app `Notification` row is created only if ≥1 in-app recipient; email goes immediate or digest-routed; push is a per-user FCM send.
3. `category` MUST be one of the 10: `post_published`, `post_failed`, `channels`, `comments`, `budget`, `media`, `announcements`, `streak`, `agent`, `analytics` (`NOTIFICATION_CATEGORIES`, `libraries/nestjs-libraries/src/dtos/notifications/notification-preference.dto.ts:26-37`).
4. Prefer an existing convenience sender when it fits instead of raw `notify`: `notifyPostPublishFailure`, `notifyPostPublished` (digest), `notifyChannelError`, `notifyBudgetThreshold`, `notifyAnalyticsAnomaly` (digest), `notifyWeeklyAnalyticsSummary`, `notifyCommentDigest` (digest), `notifyStreakReminder`, `broadcast` (announcements + `override: true`).
5. Set `channels` deliberately (e.g. push off for high-frequency categories); `digest: true` only for non-urgent, digest-eligible email; leave `override: false` except broadcasts.
6. Escape any user-controlled string before embedding it in `html` (the `_escapeHtml` pattern, notification.service.ts:577-584). Never interpolate raw user content into email HTML.

### Add a new category (3 LOCKSTEP edits, code-only, no migration)
Preferences are JSON (`notificationPreference.masters/.categories/.digestFrequency`); existing rows merge over defaults in `toData`. Edit all three or the category breaks:
1. `libraries/nestjs-libraries/src/dtos/notifications/notification-preference.dto.ts` — add to the `NotificationCategory` union (:14-24), `NOTIFICATION_CATEGORIES` (:26-37), AND a matching `@IsOptional @ValidateNested` field on `NotificationPreferenceCategoriesDto` (:62-112). Without the field, the global whitelist pipe rejects the key.
2. `libraries/nestjs-libraries/src/database/prisma/notifications/notification-preference.service.ts` — add default toggles to `DEFAULT_CATEGORY_TOGGLES` (:19-30).
3. `apps/frontend/src/components/settings/notifications/notification-preferences.panel.tsx` — add to the `NotificationCategory` union (:11-21), `CATEGORY_ORDER` (:40-51), and `CATEGORY_LABEL_KEYS` (:53-64).

### Delivery path (context, not steps)
Email: `NotificationService.sendEmail` → `EmailService.sendEmail` → Inngest `email/send` (deterministic sha256+minute-bucket id) → `createSendEmail` (`apps/backend/src/inngest/functions/send-email.ts`, global `rateLimit: 1/1s`) → provider adapter → `EmailLog` row before send. Push: FCM via `PushNotificationService` (firebase-admin, `pushToken` Prisma model, gated on `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY`). Digest: `digest: true` routes per-user `digestFrequency`; daily/weekly queue rows drain on fixed server crons (`digest-email-daily.ts`: `TZ=America/New_York 0 9 * * *`).

## Verify
- `vitest run --root libraries/nestjs-libraries` — covers `notification.service.spec.ts`, `notification-preference.service.spec.ts`, `push-notification.service.spec.ts`.
- `vitest run --root apps/backend` if you touched Inngest functions (`send-email.spec.ts`, `agent-digest.spec.ts`).
- New category: start the frontend (`pnpm run dev:frontend`, port 4200) and confirm the category renders in Settings → Notifications with working toggles.

## Checklist before finishing
- [ ] Feature code calls `NotificationService.notify` (or a convenience sender) — never `EmailService` directly.
- [ ] Category is one of the 10 in `NOTIFICATION_CATEGORIES` (or was added in all three lockstep places).
- [ ] `channels` cap set deliberately; `digest` only for non-urgent items; `override` false except broadcasts.
- [ ] User-controlled strings escaped before entering email HTML.
- [ ] No quiet-hours/per-user-timezone behavior assumed; no web-push references introduced.

## Pitfalls
- Calling `EmailService` directly from feature code — bypasses opt-outs. `EmailService` is only for the chokepoint itself and non-preference system mail (auth/password flows).
- Declaring a category in only one or two of the three lockstep places — missing DTO field gets stripped by the whitelist pipe; missing frontend entry leaves it unconfigurable.
- Assuming web-push/VAPID exists — push is FCM only; there is no `web-push` package or model. Do not invent one.
- Assuming per-user digest timing or quiet hours — digest drain is a fixed server cron; the only per-user knob is `digestFrequency` (`instant|daily|weekly|never`).
- Marking an urgent item `digest: true` — it may sit in the queue until the next cron. Digest is for non-urgent items only.
- Creating an in-app row with zero in-app recipients — `notify` already guards this; replicate the guard if writing custom fan-out.
