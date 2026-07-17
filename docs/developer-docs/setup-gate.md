# `/setup` Onboarding Gate

The setup gate is a one-time, persisted onboarding wizard shown to the first owner or admin of a new organization. It walks through the org-level providers required to use Postmill.

## Data model

- `Organization.setupCompletedAt DateTime?` — null means the wizard has not been completed. Existing organizations were backfilled as complete in the migration that added the column.

## Gate rule

The gate is a single client-side predicate over `GET /user/self`:

```ts
const mustSetup = !user.setupCompleted;
```

`LayoutComponent` (the authenticated app chrome) redirects incomplete users to `/setup` and renders nothing while redirecting to avoid a chrome flash. `/setup` lives in its own route segment under `apps/frontend/src/app/(app)/(site)/setup/` so it is outside `LayoutComponent` and cannot redirect itself.

Only users who can complete the required LLM step stay in the wizard. Members without owner/admin role are redirected to `/dashboard` because they cannot save org-level AI provider settings.

## Backend surface

- `GET /user/self` includes `setupCompleted: boolean`.
- `POST /settings/setup/complete` (auth + org-scoped) calls `OrganizationService.completeSetup(orgId)`.
- `OrganizationService.completeSetup` rejects the call with a 400 if the organization has no active LLM provider.
- `OrgAiSettingsService.upsert` auto-activates the first saved LLM provider when no active provider exists, so the wizard's LLM step can proceed after a single save.

## Wizard steps

The wizard has seven steps. Only the first step is required; the rest can be skipped and configured later in Settings.

1. **LLM** — required. Configure an AI provider (Settings → AI). The first saved provider is auto-activated.
2. **AI Media** — optional. Configure media-generation providers.
3. **Channels** — optional. Connect social channels.
4. **Content Packs** — optional. Configure premium stock providers.
5. **Storage** — optional. Configure S3/R2/B2/IDrive/local storage.
6. **Shortlinks** — optional. Configure a short-link provider.
7. **VPN** — optional. Configure VPN/proxy providers.

## Frontend components

- `apps/frontend/src/components/setup/setup-shell.tsx` — blank chrome (logo, theme toggle, avatar menu) and self-fetches `/user/self` for auth.
- `apps/frontend/src/components/setup/setup-wizard.tsx` — step state, footer, completion handler, and role gate.
- `apps/frontend/src/components/setup/setup-stepper.tsx` — responsive stepper header.
- `apps/frontend/src/components/setup/step-frame.tsx` — uniform step wrapper.
- `apps/frontend/src/components/setup/steps/step-*.tsx` — thin wrappers over existing Settings panels:
  - `step-llm.tsx`
  - `step-ai-media.tsx`
  - `step-channels.tsx`
  - `step-content-packs.tsx`
  - `step-storage.tsx`
  - `step-shortlinks.tsx`
  - `step-vpn.tsx`

## Completion flow

`setup-wizard.tsx` mutates the `/user/self` SWR cache to `{ setupCompleted: true }` **before** calling `router.replace('/dashboard')`. This prevents the `LayoutComponent` gate from seeing stale state and bouncing the user back to `/setup`.

After completion, the org can still change every configured provider from the corresponding Settings tab.

> Verified against v1.0.0
