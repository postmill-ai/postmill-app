# AI Designer

**AI Designer** (`/media/ai-designer`) is a chat-driven assistant that produces finished designs by
driving the [Designer](./designer) canvas for you — you describe what you want, it plans, writes
copy, sources assets, composes the layout, and renders variants.

This is distinct from two other AI surfaces in Postmill, which look similar but are not the same
thing:

| Surface | What it is | Where |
|---|---|---|
| **AI Designer** | A deterministic, multi-agent pipeline that produces canvas designs from a brief. | `/media/ai-designer` (this page) |
| **[Designer](./designer)** | The manual canvas/timeline editor AI Designer drives. | `/media/designer` |
| **[AI Agent](../agent)** | A conversational assistant for scheduling, analytics, campaigns, and media generation across the whole app — not canvas-specific. | Sidebar → Agent |

## How it works

AI Designer runs on a deterministic **agent-mesh pipeline** — a fixed sequence of specialist
agents, not a free-form chat model choosing its own tools. The pipeline agents are:

- **Conversationalist** — interprets your brief and interactive replies.
- **Art Director** — plans the layout (which elements, where).
- **Copywriter** — writes the on-canvas text for each slot.
- **Asset** — sources or generates the images/media the plan calls for.
- **Composer** — assembles the plan, copy, and assets into a Designer document.
- **Vision Critic** — reviews the rendered result and requests targeted fixes.

The conductor runs these steps per session, can pause for your input (an interactive form or plan
approval), and supports cancelling an in-flight run.

## Before you start

AI Designer needs **vision**, **high-reasoning**, and **low-reasoning** AI model defaults set under
**Settings → AI → Model Defaults**, plus a **Text to Image** media default under
**Settings → Content → Media Defaults**. If any is missing, the run is blocked and the chat names
the missing default(s) (its message points at the settings screen where each default lives). If a text-to-image
default is configured but its provider has since been disabled, the run continues with a warning
and falls back to stock imagery where generation was planned.

## Starting a session

Before chatting, you configure the brief:

- **Output type** — **Image** (the default) or **Video**. A session produces one or the other,
  never a mix; switching clears the format selection below.
- **Channels / Image** or **Channels / Video** — pick one or more channel presets for the chosen
  output type (e.g. Instagram Post, LinkedIn). At least one format is required.
- **Custom sizes** — for image sessions, arbitrary width/height pairs in addition to or instead of
  channel presets.
- **Save to folder** — an optional destination folder in `/files`.
- **Brand profile** — apply an existing brand's voice/visual guidelines.
- **Style** — a style preset, or **Let AI decide**.
- **Variants** — how many design variants to generate.
- **Reference images** — pick existing files or import stock media as visual references. When
  your workspace has an image-to-image default, the first reference also conditions the generated
  background/hero imagery (falling back to text-to-image, then stock).
- **Mode** — **Chat** (open-ended conversation) or **Prompt** (a single one-shot brief).

## In the session

Once started, you get a chat interface showing:

- Your messages and the pipeline's replies, including markdown-rendered guidance.
- A **live progress indicator** while an agent step is running (agent name, phase).
- **Rendered previews** as variants complete.
- Interactive prompts the pipeline may ask (e.g. a form or a plan to approve) before continuing.
- **Delivery notes** that disclose any slot where a stock photo (or a gradient placeholder) stood in
  for imagery that couldn't be generated.

After delivery you can ask for revisions in the chat — for example, "change the background"
regenerates the background imagery of an image-backed design.

### Video sessions

A video session composes each variant as a design first, then turns it into a timeline: text and
shapes enter with staggered animations, and (when a video provider is configured as a media default)
a real scene video is generated per variant (up to three per run) — animated from the composed scene, or from the plan's
concept — and placed above the still, which stays as the poster frame. Without a video provider,
the design falls back to animated stills (Ken Burns motion) and the delivery notes say so.
Revisions work on video designs too: you can change clip text, styling, timing, and transitions, or
ask to regenerate the video or change its subject.

Sessions are resumable — the session id persists in the URL (`?session=`) so a page refresh
reconnects and re-hydrates the message history instead of losing the conversation.

## Output

Finished designs are saved as real `Design` records (with rendered preview files) and can be
opened directly in the [Designer](./designer) for manual refinement, just like any other design.
Video designs open on the Designer's video timeline and export through its video render.

Intermediate files a run creates (generated assets, imported references) and design preview
thumbnails are kept out of the [Media Library](../media-library) listing. Deleting a session removes
its intermediates, except any a delivered design still uses.

---
> Verified against v1.4.0
