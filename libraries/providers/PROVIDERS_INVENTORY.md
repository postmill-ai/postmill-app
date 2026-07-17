# Providers Inventory

Machine-generated inventory of every provider **module** registered through the kernel.
Source of truth: `apps/backend/src/providers.generated.ts` (`providerModules`), enumerated via the
kernel vitest alias. One row per **module** (multi-module packages — e.g. `openai` = ai + media —
get multiple rows). The `has-spec?` column reflects whether the **package** contains any
`*.spec.ts` / `*.int-spec.ts` under `src/**`.

- **Modules:** 163  (== `providerModules.length`)
- **Packages:** 145  (== real package dirs under `libraries/providers/`, excluding `kernel` and `node_modules`)
  - Note: `ls -d libraries/providers/*/ | grep -v kernel | wc -l` = **146** on a clean checkout because it also counts the `node_modules/` dir; **145** are real packages. (After a local `--coverage` run a gitignored `coverage/` dir also appears, making the raw count **147** — both `node_modules/` and `coverage/` are non-package artifacts.)
- **Packages with at least one spec:** 91 / 145  (media adapters + the magnific content pack gained recorded-fixture `*.int-spec.ts` behavioral tests via the shared `kernel/src/testing/media-int-helpers.ts`)

Modules per domain: ai=25, auth=6, contentpack=4, email=7, media=35, shortlink=20, social=36, storage=14, vpn=16

| package | domain | providerId | version | status | has-spec? |
|---|---|---|---|---|---|
| anthropic | ai | anthropic | v1 | active | yes |
| azure | ai | azure | v1 | active | yes |
| bedrock | ai | bedrock | v1 | active | yes |
| bitdeer | ai | bitdeer | v1 | active | no |
| cohere | ai | cohere | v1 | active | yes |
| deepinfra | ai | deepinfra | v1 | active | no |
| deepseek | ai | deepseek | v1 | active | yes |
| fireworks | ai | fireworks | v1 | active | yes |
| gateway | ai | gateway | v1 | active | yes |
| gmihub | ai | gmihub | v1 | active | no |
| google | ai | google | v1 | active | yes |
| groq | ai | groq | v1 | active | yes |
| lightning | ai | lightning | v1 | active | no |
| meta-llama | ai | meta-llama | v1 | active | no |
| minimax | ai | minimax | v1 | active | no |
| mistral | ai | mistral | v1 | active | yes |
| openai | ai | openai | v1 | active | yes |
| openrouter | ai | openrouter | v1 | active | yes |
| perplexity | ai | perplexity | v1 | active | yes |
| qwen | ai | qwen | v1 | active | no |
| siliconflow | ai | siliconflow | v1 | active | no |
| togetherai | ai | togetherai | v1 | active | yes |
| vertex | ai | vertex | v1 | active | yes |
| vultr | ai | vultr | v1 | active | no |
| xai | ai | xai | v1 | active | yes |
| generic | auth | generic | v1 | active | no |
| github | auth | github | v1 | active | no |
| google | auth | google | v1 | active | yes |
| local | auth | local | v1 | active | yes |
| wallet | auth | wallet | v1 | active | no |
| wrapcast | auth | farcaster | v1 | active | no |
| adobe-stock | contentpack | adobe-stock | v1 | active | yes |
| envato | contentpack | envato | v1 | active | yes |
| magnific | contentpack | magnific | v1 | active | no |
| vecteezy | contentpack | vecteezy | v1 | active | yes |
| empty | email | empty | v1 | active | yes |
| mailgun | email | mailgun | v1 | active | yes |
| postmark | email | postmark | v1 | active | yes |
| resend | email | resend | v1 | active | yes |
| sendgrid | email | sendgrid | v1 | active | yes |
| ses | email | ses | v1 | active | yes |
| smtp | email | smtp | v1 | active | yes |
| azure | media | azure | v1 | active | yes |
| bedrock | media | bedrock | v1 | active | yes |
| black-forest-labs | media | black-forest-labs | v1 | active | no |
| deepgram | media | deepgram | v1 | active | no |
| deepinfra | media | deepinfra | v1 | active | no |
| did | media | did | v1 | active | no |
| elevenlabs | media | elevenlabs | v1 | active | no |
| fal | media | fal | v1 | active | yes |
| fireworks | media | fireworks | v1 | active | yes |
| gateway | media | gateway | v1 | active | yes |
| genviral | media | genviral | v1 | active | no |
| google-ai | media | google | v1 | active | no |
| groq | media | groq | v1 | active | yes |
| hedra | media | hedra | v1 | active | no |
| heygen | media | heygen | v1 | active | no |
| higgsfield | media | higgsfield | v1 | active | no |
| ideogram | media | ideogram | v1 | active | no |
| leonardo | media | leonardo | v1 | active | no |
| ltx | media | ltx | v1 | active | no |
| luma | media | luma | v1 | active | no |
| minimax | media | minimax | v1 | active | no |
| openai | media | openai | v1 | active | yes |
| openrouter | media | openrouter | v1 | active | yes |
| qwen | media | qwen | v1 | active | no |
| recraft | media | recraft | v1 | active | no |
| reelfarm | media | reelfarm | v1 | active | no |
| replicate | media | replicate | v1 | active | no |
| runway | media | runway | v1 | active | no |
| siliconflow | media | siliconflow | v1 | active | no |
| stability | media | stability-ai | v1 | active | no |
| tavus | media | tavus | v1 | active | no |
| togetherai | media | togetherai | v1 | active | yes |
| vertex | media | vertex | v1 | active | yes |
| wan | media | wan | v1 | active | no |
| xai | media | xai | v1 | active | yes |
| bitly | shortlink | bitly | v1 | active | yes |
| blink | shortlink | blink | v1 | active | yes |
| cleanuri | shortlink | cleanuri | v1 | active | yes |
| cuttly | shortlink | cuttly | v1 | active | yes |
| dub | shortlink | dub | v1 | active | yes |
| isgd | shortlink | isgd | v1 | active | yes |
| linkly | shortlink | linkly | v1 | active | yes |
| lnkify | shortlink | lnkify | v1 | active | yes |
| owly | shortlink | owly | v1 | active | yes |
| pixelme | shortlink | pixelme | v1 | active | yes |
| rebrandly | shortlink | rebrandly | v1 | active | yes |
| replug | shortlink | replug | v1 | active | yes |
| shortio | shortlink | shortio | v1 | active | yes |
| sniply | shortlink | sniply | v1 | active | yes |
| switchy | shortlink | switchy | v1 | active | yes |
| t2m | shortlink | t2m | v1 | active | yes |
| tinycc | shortlink | tinycc | v1 | active | yes |
| tinyurl | shortlink | tinyurl | v1 | active | yes |
| tly | shortlink | tly | v1 | active | yes |
| vgd | shortlink | vgd | v1 | active | yes |
| bluesky | social | bluesky | v1 | active | no |
| devto | social | devto | v1 | active | no |
| discord | social | discord | v1 | active | no |
| dribbble | social | dribbble | v1 | active | no |
| facebook | social | facebook | v1 | active | no |
| gmb | social | gmb | v1 | active | no |
| hashnode | social | hashnode | v1 | active | no |
| instagram | social | instagram | v1 | active | no |
| instagram-standalone | social | instagram-standalone | v1 | active | no |
| kick | social | kick | v1 | active | no |
| lemmy | social | lemmy | v1 | active | no |
| linkedin | social | linkedin | v1 | active | no |
| linkedin-page | social | linkedin-page | v1 | active | no |
| listmonk | social | listmonk | v1 | active | no |
| mastodon | social | mastodon | v1 | active | no |
| medium | social | medium | v1 | active | no |
| mewe | social | mewe | v1 | active | no |
| moltbook | social | moltbook | v1 | active | no |
| nostr | social | nostr | v1 | active | no |
| peertube | social | peertube | v1 | active | no |
| pinterest | social | pinterest | v1 | active | no |
| pixelfed | social | pixelfed | v1 | active | no |
| reddit | social | reddit | v1 | active | no |
| skool | social | skool | v1 | active | no |
| slack | social | slack | v1 | active | no |
| telegram | social | telegram | v1 | active | no |
| threads | social | threads | v1 | active | no |
| tiktok | social | tiktok | v1 | active | no |
| tumblr | social | tumblr | v1 | active | no |
| twitch | social | twitch | v1 | active | no |
| vk | social | vk | v1 | active | no |
| whop | social | whop | v1 | active | no |
| wordpress | social | wordpress | v1 | active | no |
| wrapcast | social | wrapcast | v1 | active | no |
| x | social | x | v1 | active | yes |
| youtube | social | youtube | v1 | active | no |
| backblaze-b2 | storage | backblaze_b2 | v1 | active | no |
| cloudflare-r2 | storage | cloudflare_r2 | v1 | active | yes |
| digitalocean-spaces | storage | digitalocean_spaces | v1 | active | no |
| hetzner | storage | hetzner | v1 | active | no |
| idrive-e2 | storage | idrive_e2 | v1 | active | no |
| linode | storage | linode | v1 | active | no |
| local | storage | local | v1 | active | yes |
| medialocker | storage | medialocker | v1 | active | yes |
| s3 | storage | s3 | v1 | active | no |
| s3-compatible | storage | s3_compatible | v1 | active | no |
| scaleway | storage | scaleway | v1 | active | no |
| storj | storage | storj | v1 | active | no |
| vultr | storage | vultr | v1 | active | no |
| wasabi | storage | wasabi | v1 | active | no |
| custom-proxy | vpn | custom | v1 | active | no |
| cyberghost | vpn | cyberghost | v1 | active | yes |
| expressvpn | vpn | expressvpn | v1 | active | yes |
| hideme | vpn | hideme | v1 | active | yes |
| hotspotshield | vpn | hotspotshield | v1 | active | yes |
| ipvanish | vpn | ipvanish | v1 | active | yes |
| mozillavpn | vpn | mozillavpn | v1 | active | yes |
| mullvad | vpn | mullvad | v1 | active | yes |
| nordvpn | vpn | nordvpn | v1 | active | yes |
| pia | vpn | pia | v1 | active | yes |
| protonvpn | vpn | protonvpn | v1 | active | yes |
| purevpn | vpn | purevpn | v1 | active | yes |
| surfshark | vpn | surfshark | v1 | active | yes |
| tunnelbear | vpn | tunnelbear | v1 | active | yes |
| vyprvpn | vpn | vyprvpn | v1 | active | yes |
| windscribe | vpn | windscribe | v1 | active | yes |

## B4 backlog — adapters built without a live key

**Two distinct notions of "verified" — do not conflate them:**

- **Request-shape int-spec coverage (this section):** a recorded-fixture `*.int-spec.ts` asserts the
  submit URL/method/headers/body + the completion/poll parse against a canned response (no network).
  This is a *regression guard* for the shape the adapter builds.
- **Live-key `verified` (catalog field / "Beta" badge):** the `verified` flag on
  `GET /providers/catalog` (from `kernel/src/verification.ts` `BETA_PROVIDER_KEYS`) means the shape was
  **validated against a real API key**. The whole "built without a live key" cohort below is still
  `verified: false` and surfaces a **Beta** badge in Settings → Media — *even now that they have
  request-shape int-specs*. An int-spec proves the shape is stable, **not** that it matches the live
  endpoint; only a live smoke test flips `verified` to true.

The following "built without a live key" adapters now have B4 recorded-fixture integration specs
(request-shape + poll-parse / search + resolveDownload). They remain `verified: false` (Beta) until
live-smoke-tested:

- Media (own-key studios): `wan`, `higgsfield`, `ltx`, `reelfarm`, `genviral`, `openai` (Sora media
  path), `google-ai`, `leonardo`, `recraft`, `ideogram`, `vertex` (Veo/Imagen), `qwen` (DashScope),
  `did`, `hedra`, `tavus`, `fal` (Pika)
- Media (AI-hub aggregators): `togetherai`, `siliconflow`, `groq`, `openrouter`, `fireworks`,
  `deepinfra`, `gateway`, `bedrock`, `azure`
- Content packs: `vecteezy`, `envato`, `adobe-stock`, `magnific`

No "built without a live key" adapters remain without behavioural request-shape coverage. Each spec
carries `// UNVERIFIED vs live key:` comments at the points a real key is most likely to disagree
(see e.g. the three content-pack `contentpack.int-spec.ts` files).
