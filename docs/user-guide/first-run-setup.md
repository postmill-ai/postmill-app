# First-run setup

> Verified against v1.0.0

When a brand-new organization is created, Postmill shows a one-time onboarding wizard at **`/setup`**. The wizard walks the first user through the minimum configuration needed before the app is usable:

1. **LLM provider (required)** — connect and activate at least one AI provider.
2. **AI media providers** — optional image/video/audio generation providers.
3. **Channels** — optional social-channel OAuth apps.
4. **Content packs** — optional premium stock-media provider.
5. **Storage** — optional cloud storage buckets (local storage is already enabled).
6. **Shortlinks** — optional link-shortening provider.
7. **VPN / proxy** — optional outbound proxy configuration.

The wizard reuses the same [Settings](./settings.md) panels you will see later, so anything skipped can be configured afterward from **Settings**.

## Finishing setup

The **Finish setup** button is enabled only after the LLM step has an active provider. Clicking it:

- calls `POST /settings/setup/complete`,
- sets `Organization.setupCompletedAt` to the current time,
- redirects to `/dashboard`.

Once `setupCompletedAt` is set, the organization never sees the wizard again, even if the LLM provider is later removed. Existing organizations are backfilled as already complete when the feature is deployed.

## Post-setup checklist

After finishing setup, the dashboard onboarding checklist nudges you to connect any optional providers you skipped. The checklist and the wizard are separate surfaces and coexist.
