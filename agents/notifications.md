# Notifications: the single chokepoint

LLM-facing ruleset for user-facing notifications in the Postmill monorepo. Cross-refs:
`agents/backend.md`, `agents/jobs.md`, `agents/providers/email.md`.

## The chokepoint rule

- **`NotificationService` is the SINGLE chokepoint for user-facing email + in-app +
  push** — `libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts`.
  Feature code MUST NOT call `EmailService`
  (`libraries/nestjs-libraries/src/services/email.service.ts`) directly. Why: only the
  chokepoint applies per-user master/category toggles, digest batching, member
  filtering, and HTML escaping; bypassing it sends mail users opted out of.
  (`EmailService` remains the transport used by `NotificationService` itself and by
  non-preference system mail such as auth/password flows.)
- Internal wiring (constructor, :35-42): `NotificationsRepository` (in-app rows),
  `EmailService` (email), `OrganizationRepository` (team lookup — a
  `// layering: sanctioned leaf-read`, :4-8), `NotificationPreferenceService`,
  `PushNotificationService`, `NotificationDigestService`.

## `notify()` API

`notify(options: NotifyOptions): Promise<void>` — `notification.service.ts:105`.
`NotifyOptions` (:19-31):

| Field | Type | Required | Effect |
|---|---|---|---|
| `orgId` | `string` | yes | Org whose (active) members are fanned out to. |
| `category` | `NotificationCategory` | yes | One of the 10 categories; drives per-category toggles. |
| `title` | `string` | yes | In-app title, email subject, push title. |
| `message` | `string` | yes | In-app content, email body, push body. |
| `link` | `string` | no | Stored on the in-app row (deep link). |
| `metadata` | `Record<string, any>` | no | Stored on the in-app row; stringified into push `data`. |
| `channels` | `Partial<ChannelToggles>` | no | Caller cap per channel; merged over `{ email: true, push: true, inApp: true }` (:88-90, :122). |
| `digest` | `boolean` | no | `true` ⇒ email obeys per-user `digestFrequency` (see Digest). Default `false`. |
| `override` | `boolean` | no | `true` ⇒ skip all preference gates (used by `broadcast`). Default `false`. |
| `targetUserIds` | `string[]` | no | Restrict fan-out to these members. |
| `html` | `string` | no | HTML body for digest-queue items. |

Fan-out mechanics (`notify`, :105-194):
1. `OrganizationRepository.getTeam(orgId)`; members with `disabled` membership or
   `user.activated === false` are skipped (:127-130).
2. Preferences batch-loaded via `NotificationPreferenceService.ensureDefaultsForUsers`
   (:134) — missing users get persisted defaults.
3. Per member per channel: enabled iff `channels[ch] && masters[ch] &&
   categories[category][ch]` (`_channelEnabled`, :92-103); `override: true` short-
   circuits to enabled; an unknown/legacy category gates on the master only.
4. In-app: ONE shared `Notification` row created only if ≥1 in-app recipient
   (:160-171). Email: immediate or digest-routed. Push: per-user FCM send.

Convenience senders already on the service — use them when they fit instead of raw
`notify`: `notifyPostPublishFailure`, `notifyPostPublished` (digest),
`notifyChannelError`, `notifyFirstCommentUnsupported/Failed`,
`notifyBudgetThreshold`, `notifyAnalyticsAnomaly` (digest),
`notifyWeeklyAnalyticsSummary`, `notifyCommentDigest` (digest, escapes user content via
`_escapeHtml`, NOTIF-01), `notifyStreakReminder` (:293-566). Also `broadcast(orgId,
BroadcastNotificationDto)` (:201-240): `announcements` category, `override: true`,
optional `targetUserIds`/`targetRoles` filters.

## The 10 categories — three lockstep places

Declared order: `post_published`, `post_failed`, `channels`, `comments`, `budget`,
`media`, `announcements`, `streak`, `agent`, `analytics`. Hardcoded in three places
that MUST change together:

1. **DTO** — `libraries/nestjs-libraries/src/dtos/notifications/notification-preference.dto.ts`:
   `NotificationCategory` union (:14-24), `NOTIFICATION_CATEGORIES` array (:26-37), and
   an `@IsOptional @ValidateNested` field per category in
   `NotificationPreferenceCategoriesDto` (:62-112) — the global whitelist pipe rejects
   undeclared category keys.
2. **Defaults** — `DEFAULT_CATEGORY_TOGGLES` in
   `libraries/nestjs-libraries/src/database/prisma/notifications/notification-preference.service.ts:19-30`
   (per-category default `ChannelToggles`; `DEFAULT_MASTERS` all-true, :32-36).
3. **Frontend panel** — `apps/frontend/src/components/settings/notifications/notification-preferences.panel.tsx`:
   `NotificationCategory` union (:11-21), `CATEGORY_ORDER` (:40-51),
   `CATEGORY_LABEL_KEYS` (:53-64). (`EMPTY_TOGGLES`, :32, keeps a stale frontend from
   crashing on an unknown category.)

Changing the set is **code-only** — preferences are stored as JSON
(`notificationPreference.masters` / `.categories` / `.digestFrequency`), so no Prisma
migration; existing rows merge over defaults in `toData` (`notification-preference.service.ts:52-64`).

## Channel routing & digest

- Channel selection is per user: master toggle AND category toggle (see fan-out step
  3). There are **no quiet hours and no per-user timezone scheduling** — digest timing
  is a fixed server cron (below).
- Digest (`digest: true`, email channel only) — `_routeDigestEmails` (:242-279):
  per-user `digestFrequency` (`'instant' | 'daily' | 'weekly' | 'never'`,
  `NotificationPreferenceService.getDigestFrequencies`):
  - `never` → skipped; `instant` → sent immediately via `sendEmail`;
  - `daily`/`weekly` → `NotificationDigestService.enqueueMany` writes
    `notificationDigestQueue` rows
    (`libraries/nestjs-libraries/src/database/prisma/notifications/notification-digest.service.ts:35-51`).
- Queue drain (Inngest, see `agents/jobs.md`):
  `apps/backend/src/inngest/functions/digest-email-daily.ts` (cron
  `TZ=America/New_York 0 9 * * *`) and `digest-email-weekly.ts` fetch targets
  (`DigestActivity.getPendingDigestTargets`), then fan out `digest/send-one` events
  with id `` `digest:{daily|weekly}:{userId}:{orgId}:{YYYY-MM-DD}` `` →
  `DigestActivity.sendOneDigest` sends and clears the queue.

## Email delivery path

`NotificationService.sendEmail(to, subject, html)` (:288-290) →
`EmailService.sendEmail` → Inngest event `email/send` with deterministic id
`` `email_${sha256(`${to}:${subject}:${html}`).slice(0,32)}_${minuteBucket}` ``
(`email.service.ts:43-54`; enqueue skipped when Inngest is disabled) →
`createSendEmail` (`apps/backend/src/inngest/functions/send-email.ts`) with a global
`rateLimit: { limit: 1, period: '1s' }` → `EmailActivity.sendEmail`
(`libraries/nestjs-libraries/src/inngest/activities/email.activity.ts:12-14`) →
`EmailService.sendEmailSync` → provider adapter via
`EmailAdapterRegistry.getActiveAdapter().send` (adapter selection:
`agents/providers/email.md`), wrapped in the standard template; an `EmailLog` row is
created BEFORE send and then `markSent`/`markFailed`
(`EmailLogService`, `email.service.ts:126-171`); provider errors retried 3× in-band so
Inngest sees a terminal failure. `sendEmailSync` no-ops without `EMAIL_FROM_ADDRESS` /
`EMAIL_FROM_NAME`. Recipient addresses are never logged — only a truncated sha256
(`_redactedId`, :174-176).

## Push specifics (verified)

- Push is **Firebase Cloud Messaging** via `firebase-admin` — there is **no
  `web-push`/VAPID subsystem** (no such package or model; do not invent one).
- `PushNotificationService`
  (`libraries/nestjs-libraries/src/database/prisma/notifications/push-notification.service.ts`):
  gated on `FCM_PROJECT_ID` + `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY` (`hasProvider`,
  :20-26; silently skips when unset, :137-140). Device tokens live in the `pushToken`
  Prisma model, registered via `RegisterPushTokenDto`
  (`notification-preference.dto.ts:130-140`); a token registered to another user is
  never reassigned (:64-69). Multicast failures with
  `messaging/invalid-registration-token` / `registration-token-not-registered`
  deactivate the token (:175-199).
- `NotificationService.hasEmailProvider()` / `hasPushProvider()` (:568-574) expose
  transport availability to callers/UI.

## Recipe — send a notification from feature code

1. Inject `NotificationService` through the normal
   Controller → Service → (Manager) → Repository layering (`agents/backend.md`).
2. Call `notify` with an existing category, e.g.:

```ts
await this._notificationService.notify({
  orgId,
  category: 'media',
  title: 'Your video is ready',
  message: `Render ${jobId} finished.`,
  link: `/media/${jobId}`,
  metadata: { jobId },
  channels: { email: true, push: false, inApp: true },
  digest: true, // only if the item is digest-eligible
});
```

3. Escape any user-controlled string before embedding it in `html` (`_escapeHtml`
   pattern, :577-584); never interpolate raw user content into email HTML.

## Recipe — add a new category (3 lockstep edits, no migration)

1. `notification-preference.dto.ts` — add to the `NotificationCategory` union,
   `NOTIFICATION_CATEGORIES`, and a matching `@IsOptional @ValidateNested` field on
   `NotificationPreferenceCategoriesDto`.
2. `notification-preference.service.ts` — add the default toggles to
   `DEFAULT_CATEGORY_TOGGLES`.
3. `notification-preferences.panel.tsx` — add to the union, `CATEGORY_ORDER`, and
   `CATEGORY_LABEL_KEYS`.
Then call `notify({ category: '<new>', … })` from feature code. Existing preference
rows merge over the new default automatically (`toData`).

## Checklist

- [ ] Feature code calls `NotificationService.notify` (or a convenience sender) — never `EmailService` directly.
- [ ] Category used is one of the 10 declared in `NOTIFICATION_CATEGORIES`.
- [ ] `channels` cap set deliberately (e.g. push off for high-frequency categories).
- [ ] `digest: true` only for digest-eligible, non-urgent items; `override` left `false` except broadcasts.
- [ ] User-controlled strings escaped before entering email HTML.
- [ ] New category added in all three lockstep places (DTO, `DEFAULT_CATEGORY_TOGGLES`, frontend panel).
- [ ] No quiet-hours/per-user-timezone behavior assumed — digests run on the fixed server cron.
- [ ] Push assumptions match FCM (`pushToken` model, `FCM_*` env) — no web-push references introduced.
