# Provider versions catalog

> Verified against v1.0.0

This page lists every provider currently registered in the unified provider framework, grouped by domain. All current providers are at version `v1`.

Use `GET /providers/catalog?domain=` to fetch this catalog live from the running backend. Use `GET /admin/providers/health?domain=` (super-admin) for per-version health counters.

The catalog is metadata-driven: each provider package exports `src/v1/metadata.ts` with `kind`, `domains`, `modelCategories`, `mediaCategories`, `hasModelList`, and `modelHints`. The public `/providers/catalog` endpoint and the Settings → AI *Model Defaults* / Settings → Content *Media Defaults* tabs use this metadata to build candidate sets, format labels such as `<provider>[-<ui-name>]: <model>`, and auto-rank models when no stored default exists.

A few branded media studios ride another provider's adapter:

- **Kling** and **Pika** studios use the `fal` (`fal.ai`) adapter.
- **Sora** uses the `openai` adapter.

The table below shows each provider's registered domains. A provider that appears in both `ai` and `media` can share a single org credential across both surfaces.

## AI (`ai`) — 25 providers

| Provider | ID | Domains | Kind / Notes |
|---|---|---|---|
| Amazon Bedrock | `bedrock` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, text-to-image |
| Anthropic Claude | `anthropic` | ai | direct; low-reasoning, high-reasoning, workflow, vision |
| Azure OpenAI | `azure` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, text-to-image |
| Bitdeer AI | `bitdeer` | ai | action |
| Cohere | `cohere` | ai | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point |
| DeepInfra | `deepinfra` | ai, media | hub; image-slide, image-to-image, image-to-video, text-to-image, text-to-music, text-to-speech, text-to-video |
| DeepSeek | `deepseek` | ai | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point |
| Fireworks AI | `fireworks` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, text-to-image |
| GMI Cloud | `gmihub` | ai | action |
| Google Gemini | `google` | ai, auth, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point |
| Google Vertex | `vertex` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, text-to-image, text-to-video |
| Groq | `groq` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, text-to-speech |
| Lightning AI | `lightning` | ai | action |
| Llama | `meta-llama` | ai | action |
| MiniMax | `minimax` | ai, media | direct; low-reasoning, high-reasoning, workflow; image-slide, image-to-video, text-to-video |
| Mistral AI | `mistral` | ai | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point |
| OpenAI | `openai` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-video, text-to-image, text-to-speech, text-to-video, video-caption |
| OpenRouter | `openrouter` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, text-to-image |
| Perplexity | `perplexity` | ai | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point |
| Qwen | `qwen` | ai, media | direct; image-slide, image-to-video, text-to-image, text-to-video |
| SiliconFlow | `siliconflow` | ai, media | hub; image-slide, image-to-image, image-to-video, text-to-image, text-to-speech, text-to-video |
| Together AI | `togetherai` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, image-to-video, text-to-image, text-to-speech, text-to-video |
| Vercel AI | `gateway` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, image-to-video, text-to-image, text-to-video |
| Vultr Inference | `vultr` | ai, storage | action |
| xAI Grok | `xai` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, text-to-image |

## Auth (`auth`) — 6 providers

| Provider | ID |
|---|---|
| Email & Password | `local` |
| Farcaster | `farcaster` |
| GitHub | `github` |
| Google | `google` |
| OIDC | `generic` |
| Wallet | `wallet` |

## Content packs (`contentpack`) — 4 providers

| Provider | ID |
|---|---|
| Adobe Stock | `adobe-stock` |
| Envato Elements | `envato` |
| Magnific | `magnific` |
| Vecteezy | `vecteezy` |

## Email (`email`) — 7 providers

| Provider | ID |
|---|---|
| empty | `empty` |
| mailgun | `mailgun` |
| postmark | `postmark` |
| resend | `resend` |
| sendgrid | `sendgrid` |
| ses | `ses` |
| smtp | `smtp` |

## Media (`media`) — 36 providers

| Provider | ID | Domains | Kind / Notes |
|---|---|---|---|
| Amazon Bedrock | `bedrock` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, text-to-image |
| Azure OpenAI | `azure` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, text-to-image |
| Black Forest Labs | `black-forest-labs` | media | direct; image-slide, text-to-image |
| D-ID | `did` | media | action; image-to-video, text-to-video, video-avatar |
| Deepgram | `deepgram` | media | action; video-caption |
| DeepInfra | `deepinfra` | ai, media | hub; image-slide, image-to-image, image-to-video, text-to-image, text-to-music, text-to-speech, text-to-video |
| ElevenLabs | `elevenlabs` | media | direct; text-to-speech |
| Fireworks AI | `fireworks` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, text-to-image |
| Genviral | `genviral` | media | hub; image-to-video, text-to-video |
| Google AI Studio | `google` | ai, auth, media | direct; image-slide, text-to-image, text-to-video |
| Google Vertex | `vertex` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, text-to-image, text-to-video |
| Groq | `groq` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, text-to-speech |
| Hedra | `hedra` | media | action; image-to-video, text-to-video, video-avatar |
| HeyGen | `heygen` | media | action; image-to-video, text-to-video, video-avatar |
| Higgsfield | `higgsfield` | media | direct; image-slide, image-to-video, text-to-image |
| Ideogram | `ideogram` | media | action; image-slide, image-to-image, text-to-image |
| Kling | `fal` | media | direct; image-slide, image-to-video, text-to-video |
| Leonardo.ai | `leonardo` | media | direct; image-slide, text-to-image |
| LTX Studio | `ltx` | media | direct; image-to-video, text-to-video |
| Luma | `luma` | media | direct; image-to-video, text-to-video |
| MiniMax | `minimax` | ai, media | direct; low-reasoning, high-reasoning, workflow; image-slide, image-to-video, text-to-video |
| OpenAI | `openai` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-video, text-to-image, text-to-speech, text-to-video, video-caption |
| OpenRouter | `openrouter` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, text-to-image |
| Qwen | `qwen` | ai, media | direct; image-slide, image-to-video, text-to-image, text-to-video |
| Recraft | `recraft` | media | direct; image-slide, text-to-image |
| Reel.Farm | `reelfarm` | media | action; image-to-video, text-to-video |
| Replicate | `replicate` | media | direct; image-bg-remove, image-inpaint, image-slide, image-to-image, image-to-video, image-upscale, text-to-image, text-to-music, text-to-video, video-background, video-to-video, video-upscale |
| Runway | `runway` | media | direct; image-slide, image-to-video, text-to-image |
| SiliconFlow | `siliconflow` | ai, media | hub; image-slide, image-to-image, image-to-video, text-to-image, text-to-speech, text-to-video |
| Stability AI | `stability-ai` | media | direct; image-slide, text-to-image |
| Suno | `suno` | media | direct; text-to-music |
| Tavus | `tavus` | media | action; image-to-video, text-to-video, video-avatar |
| Together AI | `togetherai` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, image-to-video, text-to-image, text-to-speech, text-to-video |
| Vercel AI | `gateway` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, image-to-video, text-to-image, text-to-video |
| Wan | `wan` | media | direct; image-slide, image-to-video, text-to-image, text-to-video |
| xAI Grok | `xai` | ai, media | hub; low-reasoning, high-reasoning, workflow, vision; image-focal-point, image-slide, image-to-image, text-to-image |

## Short-link (`shortlink`) — 20 providers

| Provider | ID |
|---|---|
| Bitly | `bitly` |
| BL.INK | `blink` |
| CleanURI | `cleanuri` |
| Cutt.ly | `cuttly` |
| Dub.co | `dub` |
| is.gd | `isgd` |
| Linkly | `linkly` |
| Lnkify | `lnkify` |
| Ow.ly | `owly` |
| PixelMe | `pixelme` |
| Rebrandly | `rebrandly` |
| Replug | `replug` |
| Short.io | `shortio` |
| Sniply | `sniply` |
| Switchy | `switchy` |
| T.LY | `tly` |
| T2M | `t2m` |
| Tiny.cc | `tinycc` |
| TinyURL | `tinyurl` |
| v.gd | `vgd` |

## Social / channel (`social`) — 36 providers

| Provider | ID |
|---|---|
| Bluesky | `bluesky` |
| Dev.to | `devto` |
| Discord | `discord` |
| Dribbble | `dribbble` |
| Facebook Page | `facebook` |
| Farcaster | `wrapcast` |
| Google My Business | `gmb` |
| Hashnode | `hashnode` |
| Instagram (Facebook Business) | `instagram` |
| Instagram (Standalone) | `instagram-standalone` |
| Kick | `kick` |
| Lemmy | `lemmy` |
| LinkedIn | `linkedin` |
| LinkedIn Page | `linkedin-page` |
| ListMonk | `listmonk` |
| Mastodon | `mastodon` |
| Medium | `medium` |
| MeWe | `mewe` |
| Moltbook | `moltbook` |
| Nostr | `nostr` |
| PeerTube | `peertube` |
| Pinterest | `pinterest` |
| Pixelfed | `pixelfed` |
| Reddit | `reddit` |
| Skool | `skool` |
| Slack | `slack` |
| Telegram | `telegram` |
| Threads | `threads` |
| Tiktok | `tiktok` |
| Tumblr | `tumblr` |
| Twitch | `twitch` |
| VK | `vk` |
| Whop | `whop` |
| WordPress | `wordpress` |
| X | `x` |
| YouTube | `youtube` |

## Storage (`storage`) — 14 providers

| Provider | ID |
|---|---|
| AWS S3 | `s3` |
| Backblaze B2 | `backblaze_b2` |
| Cloudflare R2 | `cloudflare_r2` |
| DigitalOcean Spaces | `digitalocean_spaces` |
| Hetzner | `hetzner` |
| iDrive E2 | `idrive_e2` |
| Linode | `linode` |
| Local Filesystem | `local` |
| MediaLocker | `medialocker` |
| S3-Compatible | `s3_compatible` |
| Scaleway | `scaleway` |
| Storj | `storj` |
| Vultr Object Storage | `vultr` |
| Wasabi | `wasabi` |

## VPN (`vpn`) — 16 providers

| Provider | ID |
|---|---|
| Custom VPN / Proxy | `custom` |
| CyberGhost | `cyberghost` |
| ExpressVPN | `expressvpn` |
| hide.me | `hideme` |
| Hotspot Shield | `hotspotshield` |
| IPVanish | `ipvanish` |
| Mozilla VPN | `mozillavpn` |
| Mullvad VPN | `mullvad` |
| NordVPN | `nordvpn` |
| Private Internet Access | `pia` |
| Proton VPN | `protonvpn` |
| PureVPN | `purevpn` |
| Surfshark | `surfshark` |
| TunnelBear | `tunnelbear` |
| VyprVPN | `vyprvpn` |
| Windscribe | `windscribe` |

## Lifecycle statuses

| Status | Meaning |
|---|---|
| `preview` | Available for opt-in; writes require `allowPreview`. |
| `active` | Default for new configs. |
| `deprecated` | Existing pinned rows keep working; new writes are rejected unless the write is an in-place update of an already-pinned row. |
| `retired` | Existing rows fail to resolve; returns `410 Gone`. |

See [Provider Framework](./provider-framework.md) for architecture and resolution rules. The end-user capability matrix is in [Supported Channels](../user-guide/supported-channels.md).
