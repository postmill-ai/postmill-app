# Getting Started

This guide walks you through setting up your Postmill account, connecting your first social
channel, and scheduling your first post.

## 1. Register an Account

Visit your Postmill instance and complete the signup form. You will need:

- Your name
- An email address
- A secure password
- Your organization name

After registration, check your email for the activation link. Click it to verify your account and
log in. The first user of an organization becomes its **Owner** (full access including billing —
see [team roles](./settings.md#teams-tab)). Depending on how your instance is configured, you may
also be able to sign in with Google, GitHub, or your company's OIDC identity provider.

## 2. Connect Your First Channel

Navigate to **Settings** (`/settings`) and open the **Channels** tab. Postmill supports 36
channels across social media, chat platforms, blogging platforms, and email:

| # | Channel            | Identifier           | Auth Method               |
|---|--------------------|----------------------|---------------------------|
| 1 | X                  | `x`                  | OAuth 2.0                 |
| 2 | LinkedIn           | `linkedin`           | OAuth 2.0                 |
| 3 | LinkedIn Page      | `linkedin-page`      | OAuth 2.0                 |
| 4 | Reddit             | `reddit`             | OAuth 2.0                 |
| 5 | Instagram Business | `instagram`          | Facebook OAuth            |
| 6 | Instagram Standalone | `instagram-standalone` | Username + Password   |
| 7 | Facebook Page      | `facebook`           | OAuth 2.0                 |
| 8 | Threads            | `threads`            | OAuth 2.0                 |
| 9 | YouTube            | `youtube`            | OAuth 2.0                 |
|10 | Google My Business | `gmb`                | OAuth 2.0                 |
|11 | TikTok             | `tiktok`             | OAuth 2.0                 |
|12 | Pinterest          | `pinterest`          | OAuth 2.0                 |
|13 | Dribbble           | `dribbble`           | OAuth 2.0                 |
|14 | Discord            | `discord`            | Bot Token / Webhook       |
|15 | Slack              | `slack`              | Bot Token / Webhook       |
|16 | Kick               | `kick`               | OAuth 2.0                 |
|17 | Twitch             | `twitch`             | OAuth 2.0                 |
|18 | Mastodon           | `mastodon`           | OAuth 2.0                 |
|19 | Bluesky            | `bluesky`            | App Password              |
|20 | Lemmy              | `lemmy`              | Username + Password       |
|21 | Farcaster          | `wrapcast`           | Warpcast API Key          |
|22 | Telegram           | `telegram`           | Bot Token                 |
|23 | Nostr              | `nostr`              | Private Key (nsec)        |
|24 | VK                 | `vk`                 | OAuth 2.0                 |
|25 | Medium             | `medium`             | API Token                 |
|26 | Dev.to             | `devto`              | API Key                   |
|27 | Hashnode           | `hashnode`           | API Token                 |
|28 | WordPress          | `wordpress`          | Application Password      |
|29 | ListMonk           | `listmonk`           | API Key + Server URL      |
|30 | Moltbook           | `moltbook`           | OAuth 2.0                 |
|31 | Whop               | `whop`               | OAuth 2.0                 |
|32 | Skool              | `skool`              | Browser Extension (cookie)|
|33 | MeWe               | `mewe`               | OAuth 2.0                 |
|34 | Tumblr             | `tumblr`             | OAuth 1.0a                |
|35 | Pixelfed           | `pixelfed`           | OAuth 2.0                 |
|36 | PeerTube           | `peertube`           | OAuth 2.0                 |

See [Supported Channels](./supported-channels.md) for the full capability matrix (analytics,
comments, polls, video, carousel, alt text, and more).

### Browser Extension for Skool

Skool uses cookie-based authentication via the Postmill browser extension. Install the extension
from your browser's extension store, then connect your Skool account through the Settings →
Channels page. The extension captures the necessary `client_id` and `auth_token` cookies from your
active Skool session.

## 3. Create and Schedule Your First Post

1. Go to the **Posts** page (`/posts`) — this is your content schedule.
2. Click the **New Post** button (top-right).
3. Select one or more channels you have connected.
4. Write your post content in the text editor.
5. Optionally attach media by dragging files into the upload area or selecting from your media
   library.
6. Choose a publish date and time using the date/time picker.
7. Click **Schedule** to add the post to your queue, or **Publish Now** to send it immediately.

Your post appears on the calendar grid at the scheduled time. When the scheduled time arrives, the
Postmill workflow engine publishes it to the selected channels.

## 4. Main Navigation

Postmill is organized into these sections, accessible from the left sidebar:

| Page            | Route           | Purpose                                                |
|-----------------|-----------------|--------------------------------------------------------|
| Posts           | `/posts`        | Post schedule (calendar) view for scheduling and managing content|
| Agents          | `/agents`       | AI agent for content generation and automation         |
| Comments        | `/comments`     | Unified inbox for social comments across all channels  |
| Analytics       | `/analytics`    | Dashboard with overview, channel, post, and best-time metrics |
| Media           | `/media`        | Media library (upload, organize, search)               |
| Campaigns       | `/campaigns`    | Campaign folders for grouping posts and analytics      |
| Settings        | `/settings`     | Org settings: profile, channels, team, AI, billing     |

## 5. Next Steps

- Customize your timezone in **Settings** → **Profile** — all calendar dates and scheduling times
  respect your selected timezone.
- Invite team members from **Settings** → **Team**.
- Configure AI providers in **Settings** → **AI** to enable AI-powered content generation.
- Set up campaigns to organize posts into themed folders: [Campaigns](./campaigns.md).
- Explore the full composer capabilities: [Composer](./composer.md).

> Verified against v1.0.0
