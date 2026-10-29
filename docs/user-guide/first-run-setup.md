# First-run setup

> Verified against v1.4.0

When a brand-new organization is created, Postmill shows a one-time onboarding wizard at **`/setup`**. The wizard walks the first user through the minimum configuration needed before the app is usable:

1. **LLM provider (required)** — connect and activate at least one AI provider.
2. **AI media providers** — optional image/video/audio generation providers.
3. **Channels** — optional social-channel OAuth apps.
4. **Content packs** — optional premium stock-media provider.
5. **Storage** — optional cloud storage buckets (local storage is already enabled).
6. **Shortlinks** — optional link-shortening provider.
7. **VPN / proxy** — optional outbound proxy configuration.

The wizard reuses the same [Settings](./settings.md) panels you will see later, so anything skipped can be configured afterward from **Settings**.

Setup configures organization-level providers, so only an owner or admin can complete it: finishing calls `POST /settings/setup/complete`, which requires the `settings:update` permission. A member who opens `/setup` is sent to `/dashboard` instead — also when the permission lookup itself fails (for example while the backend restarts), rather than being stranded on the wizard. If the backend restarts during your session, the wizard keeps retrying its permission and account lookups and revalidates when the connection is back, so **Finish setup** recovers on its own.

Every step except **LLM** has a **Skip** button. The wizard footer links back to this guide (**Need help? Read the setup guide**) and to **Contact support**.

## The LLM step

Postmill uses AI to help write posts, replies, and media descriptions, so this step needs an API key from an AI provider. The key is stored encrypted, and you can change or remove the provider at any time in **Settings**.

- Providers marked **Easiest to start** are the recommended picks for first-timers; **Free tier available** marks providers (Google, Groq, OpenRouter) that offer a free tier.
- A provider's form shows a **Where do I get my API key?** link to that provider's API-keys page (OpenAI, Google, Anthropic, Groq, OpenRouter, DeepSeek, Mistral, xAI) and, where available, a **Docs** link.
- If a pasted key doesn't match the provider's usual prefix, a non-blocking warning asks you to double-check it.
- Saving tests the connection first. If the test fails, nothing is saved and the provider's actual error (for example, an invalid API key) is shown; **Save anyway** stores the configuration regardless.

The first provider you save is activated automatically, which unlocks **Next**.

## Finishing setup

The **Finish setup** button appears only after the LLM step has an active provider. Clicking it:

- calls `POST /settings/setup/complete` (owners/admins — `settings:update`),
- sets `Organization.setupCompletedAt` to the current time,
- redirects to `/dashboard`.

Once `setupCompletedAt` is set, the organization never sees the wizard again, even if the LLM provider is later removed. Existing organizations are backfilled as already complete when the feature is deployed.

## Post-setup checklist

After finishing setup, the dashboard onboarding checklist nudges you to connect any optional providers you skipped. The checklist and the wizard are separate surfaces and coexist.
