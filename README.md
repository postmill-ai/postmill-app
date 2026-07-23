<p align="center">
  <a href="https://postmill.ai" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/dece1bba-5703-408c-a712-02f7a7953f02">
    <img alt="Postmill Logo" src="https://github.com/user-attachments/assets/f5861b90-f71f-4ff7-90e4-6eb308023f17" width="280"/>
  </picture>
  </a>
</p>

<p align="center">
  <a href="https://opensource.org/license/agpl-v3">
    <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License: AGPL-3.0">
  </a>
  <a href="https://postmill.ai">
    <img src="https://img.shields.io/badge/version-v1.0.0-2B5CD3.svg" alt="Version v1.0.0">
  </a>
  <a href="https://docs.postmill.ai">
    <img src="https://img.shields.io/badge/docs-docs.postmill.ai-2B5CD3.svg" alt="Documentation">
  </a>
</p>

---

**The open-source, AI-native social media scheduling platform.**

Self-hosted, bring-your-own-key AI across 26+ providers, 36+ channels, and 46 built-in media tools — an open-source alternative to Buffer, Hootsuite, and Sprout Social. Postmill is built for agencies, teams, and multi-brand operators who want to schedule everywhere, generate on-brand content with their own AI keys, and own their entire stack.

**[Website](https://postmill.ai)** · **[Docs](https://docs.postmill.ai)** · **[Quick Start](#-quick-start)** · **[Node SDK (`@postmill-ai/postmill-sdk`)](https://www.npmjs.com/package/@postmill-ai/postmill-sdk)** · **[Public API](https://docs.postmill.ai)**

---

## 📸 Screenshots

<!-- TODO(media follow-up): product screenshots + demo video. Do NOT reuse upstream images. -->

Screenshots and a product demo video are coming soon. In the meantime, explore the full feature tour in the [documentation](https://docs.postmill.ai).

---

## 🤖 AI at the core — BYOK, governed, multi-provider

Postmill is AI-native from the ground up. A single governed AI layer powers every surface, and you bring your own keys: **26 providers** — 14 direct model providers plus 12 multi-model hubs and gateways — configured per organization, with no bundled credits, quotas, or metering. Pick the exact model from an admin screen and switch providers everywhere without a redeploy.

On top of that: brand-voice profiles, a shared prompt library, retrieval-augmented (RAG) search over your own content, compliance guardrails (prompt-injection / PII / brand-safety / NSFW), per-org spend caps with a full audit log, and an agent/MCP automation surface. Every AI entry point is scoped, rate-limited, and budget-checked — and a deployment's environment key is never silently billed to a tenant.

## 🎨 46 built-in media tools

Create everything in-app without leaving Postmill. The media suite is **46 tools**: the **Designer** (a Konva canvas plus a full video timeline), the **AI Designer**, **38 BYOK provider studios** spanning image, video, audio, avatar, and music generation, and **6 stock browsers** for photos, videos, vectors, stickers, audio, and icons. Every generated or sourced asset lands in your media library, ready to attach to a post.

## 📢 36+ channels, one composer

Schedule and publish across 36+ social, chat, blogging, and email channels from a single composer. Native support for polls, first-comment automation, threads, per-channel settings, and channel-aware previews means each platform gets exactly what it expects — from a single write.

## 📊 Persisted multi-channel analytics

Metrics are snapshotted daily and persisted, so you get real period-over-period trends instead of one-off live fetches. Drill into any channel, metric, or date range; see best-time-to-post heatmaps, prioritized recommendations, anomaly alerts, and a competitor watchlist — all normalized into a consistent cross-provider metric set.

## 💬 Cross-channel comment inbox

Every reply on everything you publish, synced into one inbox. Reply, like, assign to teammates, draft responses with AI, filter by unread/status/sentiment, and bulk-mark-read — without bouncing between platforms.

## 🗂️ Campaign Hub

Group posts, media, and channels into campaigns with automatic UTM tagging, draft approvals, goals, and KPIs. Share a read-only client report via a public link, and keep the team aligned with an internal discussion thread on each campaign.

## 👥 Teams, RBAC & multi-brand

Fine-grained role-based access control with **5 seeded roles** (Owner / Admin / Editor / Member / Viewer) plus custom roles drawn from a **90-permission catalog (18 resources × 5 actions)**. Manage multiple brands per organization with per-post brand selection, session and refresh-token rotation with per-device revoke, and SSO via Google, GitHub, or generic OIDC.

## 🔒 Self-hosted & security-hardened

Own your whole stack. Secrets are encrypted at rest (AES-GCM), all user-influenced outbound HTTP is SSRF-safe, and the app ships CSRF protection, Helmet, a strict CSP, and effective rate-limiting. Connect channels with your own per-tenant OAuth apps, bring your own object storage (S3 / R2 / Backblaze B2 / IDrive), swap in pluggable email and short-link providers, and optionally route outbound posting through per-channel VPN egress.

## 🌐 Supported channels

X · LinkedIn · LinkedIn Page · Reddit · Instagram Business · Instagram Standalone · Facebook Page · Threads · YouTube · Google My Business · TikTok · Pinterest · Dribbble · Discord · Slack · Kick · Twitch · Mastodon · Bluesky · Lemmy · Farcaster · Telegram · Nostr · VK · Medium · Dev.to · Hashnode · WordPress · ListMonk · Moltbook · Whop · Skool · MeWe · Tumblr · Pixelfed · PeerTube

## 🚀 Quick Start

```bash
git clone https://github.com/postmill-ai/postmill-app.git
cd postmill-app
pnpm install
cp .env.example .env                                   # then fill in your values
docker compose -f docker-compose.dev.yaml up -d        # postgres + redis
pnpm run dev:minimal                                   # backend + frontend
```

The frontend runs on port `4200`. For the full setup, configuration reference, and production deployment guide, see the [documentation](https://docs.postmill.ai).

## 🔗 Automation & integrations

Postmill exposes a full **Public API** for programmatic scheduling, analytics, and channel management, an **MCP** surface for AI agents, and an official Node SDK — [`@postmill-ai/postmill-sdk`](https://www.npmjs.com/package/@postmill-ai/postmill-sdk). The Public API is compatible with low-code automation platforms such as n8n, Make, and Zapier, so you can wire Postmill into your existing workflows. See the [API docs](https://docs.postmill.ai) to get started.

## 🛠️ Tech stack

- pnpm workspaces (monorepo)
- Next.js (React, App Router)
- NestJS
- Prisma + PostgreSQL
- Inngest (background jobs)
- Redis
- Pluggable email, storage, short-link, and AI providers

## ✅ Compliance

- Postmill is an open-source, self-hosted social media scheduling tool that supports platforms like X (formerly Twitter), Bluesky, Mastodon, Discord, and others.
- The Postmill hosted service uses official, platform-approved OAuth flows.
- Postmill does not automate or scrape content from social media platforms.
- Postmill users always authenticate directly with the social platform (e.g., X, Discord, etc.), ensuring platform compliance and data privacy.

## 🙏 Acknowledgements

Postmill began as a fork of [Postiz](https://github.com/gitroomhq/postiz-app), the open-source social scheduling tool created by Nevo David and the Gitroom team. Huge thanks to them for the foundation this project is built on. Postmill has since grown into its own standalone, AI-native platform, but the original work made it possible.

## About

Postmill is created and maintained by [REAA Technologies](https://reaatech.com), a leader in open-source AI solutions, and is built on official [@reaatech](https://www.npmjs.com/~reaatech) packages for its agentic foundations — including `@reaatech/agent-mesh`, `@reaatech/guardrail-chain`, `@reaatech/hybrid-rag`, `@reaatech/agent-budget-*`, and the `@reaatech/media-pipeline-mcp-*` suite.

## License

This repository's source code is available under the [AGPL-3.0 license](LICENSE).
