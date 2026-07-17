# Plugs

> Verified against v1.0.0

Plugs are automation hooks attached to social channel providers. They allow providers to define custom actions that run either on a schedule after publish (auto plugs) or immediately after a post is published (post plugs). Both are configured in the composer's per-channel settings panel.

## Two plug types

### Auto Plugs (`@Plug` decorator)

Polling-based background jobs that react to analytics or time-based triggers.

Declared with the `@Plug` decorator from `@gitroom/helpers/decorators/plug.decorator`:

```typescript
@Plug({
  identifier: 'republish-top-post',
  title: 'Republish top post',
  description: 'When a post reaches a certain number of likes, republish it',
  runEveryMilliseconds: 3600000,  // How often to check
  totalRuns: 10,                  // Max number of runs (0 = unlimited)
  disabled: false,
  fields: [
    {
      name: 'likes',
      description: 'Number of likes threshold',
      type: 'number',
      placeholder: '100',
      validation: /^\d+$/,
    },
  ],
})
```

Parameters:

- `identifier` — unique plug name.
- `runEveryMilliseconds` — polling interval.
- `totalRuns` — max runs (`0` = unlimited).
- `fields` — configuration fields the user fills in the UI.

### Internal / Post Plugs (`@PostPlug` decorator)

One-shot actions executed immediately after a post is successfully published.

Declared with the `@PostPlug` decorator from `@gitroom/helpers/decorators/post.plug`:

```typescript
@PostPlug({
  identifier: 'repost-as-page',
  title: 'Repost as LinkedIn Page',
  description: 'After posting, have your LinkedIn Page repost it',
  pickIntegration: ['linkedin-page'],  // Only show when these providers are connected
  fields: [
    {
      name: 'message',
      description: 'Repost message',
      type: 'text',
      placeholder: 'Check out this post!',
    },
  ],
})
```

Parameters:

- `identifier` — unique plug name.
- `pickIntegration` — array of provider identifiers that must be connected for this plug to be available.
- `fields` — configuration fields.

## How plugs work

### Registration

1. Providers declare plugs using `@Plug` or `@PostPlug` decorators on methods.
2. The decorators store metadata on the prototype via `Reflect.defineMetadata` (`custom:plug` for auto plugs, `custom:internal_plug` for post plugs).
3. `IntegrationManager.getAllPlugs()` reads this metadata at runtime and returns all available plug definitions.
4. The frontend fetches `/integrations/plug/list` to discover available plugs.

### Configuration

Both plug types are configured **in the composer's per-channel settings panel** (there is no standalone `/plugs` page). The panel is shown per selected channel and only surfaces the plugs that channel's provider actually declares.

**Auto plugs (channel-wide)** — the `ChannelGlobalPlugs` section:

1. The frontend fetches `/integrations/plug/list` and matches the entry for the channel's provider identifier (renders nothing if the provider declares no auto plugs, or the member lacks `channels:update`).
2. It fetches `/integrations/:id/plugs` for existing configurations.
3. Configuration is saved via `POST /integrations/:id/plugs` with `PlugDto` and toggled via `PUT /integrations/plugs/:id/activate`.
4. Data is stored in the `Plugs` Prisma table, upserted by `(plugFunction, integrationId)` — so the config is **channel-wide** and applies to every post that channel publishes.

**Post plugs (per-post)** — the `InternalChannels` section, fetched from `/integrations/:identifier/internal-plugs`. Its values are written into the post's `settings` JSON (`plug--<identifier>--*` keys) and travel with that single post.

### Execution

**Auto Plugs**: During the post workflow, `PostActivity` checks configured plugs. When conditions are met, the plug handler is called.

**Post Plugs**: Executed by the `post/publish` Inngest function immediately after a successful `provider.post()`, before the workflow completes. Idempotency comes from Inngest's durable `step.run`.

## Frontend integration

Both plug surfaces live in the composer's per-channel settings panel (`composer/providers/high.order.provider.tsx`, portalled into `#social-settings`):

- `composer/providers/channel.global.plugs.tsx` — the channel-wide **auto plugs** section, with per-plug cards and a configuration modal built with `react-hook-form` + validation.
- `launches/internal.channels.tsx` (`InternalChannels`) — the per-post **post plugs** section.

The configuration modal renders fields based on the plug's `fields` definition (type, placeholder, validation regex).

## Plug data flow

```
Provider @Plug/@PostPlug decorator
  → Reflect metadata ('custom:plug' / 'custom:internal_plug')
    → IntegrationManager.getAllPlugs() reads metadata
      → GET /integrations/plug/list → composer channel-settings panel renders available plugs
      → User configures plug → POST /integrations/:id/plugs
        → Stored in Plugs table (upsert by plugFunction + integrationId)
          → post/publish Inngest function reads plugs during publish
            → Post plugs: run once after provider.post()
            → Auto plugs: scheduled for totalRuns at runEveryMilliseconds
```

## Security notes

- Plug handlers run with the same credentials as the channel they belong to.
- Outbound HTTP from a plug must go through `safeFetch` or `this.fetch()`; never use bare `fetch()` on user-influenced URLs.
- Post plugs are persisted inside the post `settings` JSON and validated through the same DTO pipeline as other post settings.
