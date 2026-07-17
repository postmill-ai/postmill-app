# AI Agent

The Postmill AI agent is your natural-language assistant for scheduling posts,
generating media, checking analytics, managing campaigns, and replying to synced
social comments. Open it anytime from **Agent** in the sidebar.

This page covers the conversational agent at `/agents`. For the canvas AI
Designer assistant in `/media/ai-designer`, see [AI Designer](./media/ai-designer.md);
for the manual Konva Designer, see [Designer](./media/designer.md).

> Verified against v1.0.0

---

## What you can ask

### Scheduling & posts

* "Schedule a post about our summer sale to X, LinkedIn, and Instagram for
  tomorrow at 9am."
* "Reschedule the post about the webinar to next Tuesday."
* "Approve the draft titled 'Product launch'."
* "Delete the post group 'old-campaign-123'."

### Media generation

* "Generate an image of a beach sunset for my vacation post."
* "Create a short video clip of a city skyline at night using Runway."
* "Make a voiceover of this script with ElevenLabs."

### Media studios

* "List my configured media providers."
* "Generate a 1920x1080 image with Flux."
* "Start a Luma text-to-video job and tell me when it's ready."

### Analytics

* "Show me the analytics overview for last month."
* "What is the best time to post this week?"
* "Give me recommendations based on last month's performance."
* "How did the post about the webinar perform?"

### Campaigns

* "Create a campaign called 'Q3 Launch'."
* "Add post 'summer-sale-1' to campaign 'Q3 Launch'."
* "Show the dashboard for campaign 'Q3 Launch'."

### Comments

* "Show me unread comments in my inbox."
* "Reply to comment abc-123 on post xyz-789 saying 'Thanks for the feedback!'"

### Files & stock

* "Search my file library for 'logo'."
* "Find free stock photos of a workspace."

---

## Channel selection

Use the channel picker in the agent toolbar to pre-select the channels you want
to post to. The agent sees your selection as structured context, so you can say
"post this here" without naming every channel.

You can still override channels by name in your message.

---

## Confirmation flow

The agent asks for explicit confirmation before outward actions:

| Action | What you see |
|---|---|
| Schedule a post | The composer modal opens pre-filled with the draft. You can edit and schedule, or cancel. |
| Reply to a comment | A card shows the draft message and the post/comment id. Approve sends it; Reject cancels. |
| Generate media in a studio | A card shows provider, operation, model, and prompt. Approve submits the job; Reject cancels. |
| Create/update/tag a campaign | Confirmation card with the planned changes. |
| Delete or approve a post | Confirmation card before the destructive/irreversible action. |

MCP or API callers do not see these cards; they use scopes and tool annotations
instead.

---

## Tool-call visibility

As the agent works, you will see compact cards showing which specialist/tool ran
and key outputs such as:

* Job ids for media generations.
* Campaign ids for newly created campaigns.
* Comment ids for replies.
* Links to `/media`, `/launches`, `/analytics`, or `/files` when relevant.

Media-studio jobs include a live status indicator that polls until the artifact
is ready.

---

## Context from other pages

When you navigate to the agent from another Postmill view, it can carry a
snapshot of what you were looking at — the current calendar week, visible post
ids, selected campaign, or open post id. This lets you say things like:

* "Schedule these three posts" (referring to visible drafts).
* "Add the selected post to the campaign."
* "Reply to the top comment on this post."

The context is ids and labels only; full post bodies are never sent.

---

## Weekly agent briefs (proactive)

The agent can also work for you on a schedule. When enabled, once a week it reviews
last week's performance, your recommendations, and your comment backlog, then drafts a
proposed plan for the coming week and saves it as a **new agent thread** so you can open
it and keep the conversation going.

* **Opt-in and off by default.** Turn it on under **Settings → Notifications → Agent
  briefs** (per channel: email, push, in-app). If no one in your organization enables it,
  the weekly run is skipped entirely.
* **Read-only.** The proactive run can *analyze and draft* but never schedules, replies,
  deletes, or spends on media on its own — you review its suggestions and act on them
  interactively.
* **Cost-aware.** Each run is checked against your AI budget before it starts and is
  skipped (silently) if you are over budget.
* **Deep-linked.** The notification links straight to the generated thread at
  `/agents/<thread>`, where you can turn the proposed drafts into real scheduled posts.

Operators: the weekly job is gated by `AGENT_DIGEST_ENABLED` and the Inngest handler —
see the operations guide.

---

## Tips

* Be specific about dates and times. The agent schedules in UTC but displays
  times in your timezone.
* Mention the channel by name ("X", "LinkedIn page", "Instagram") if you did not
  pre-select channels.
* For media generation, you can ask "use Runway" or "use Luma" if you have those
  providers configured in **Settings → Media**.
* The agent cannot act without an active AI provider. If AI is off, the page will
  prompt you to configure one in **Settings → AI**.
