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

## Starting a session

Before chatting, you configure the brief:

- **Channels / formats** — pick one or more channel presets (e.g. Instagram Post, LinkedIn) or add
  a custom width × height. At least one is required.
- **Custom sizes** — arbitrary width/height pairs, in addition to or instead of channel presets.
- **Save path** — an optional destination folder in `/files`.
- **Brand profile** — apply an existing brand's voice/visual guidelines.
- **Variants** — how many design variants to generate.
- **Reference images** — pick existing files or import stock media as visual references.
- **Mode** — **Chat** (open-ended conversation) or **Prompt** (a single one-shot brief).

## In the session

Once started, you get a chat interface showing:

- Your messages and the pipeline's replies, including markdown-rendered guidance.
- A **live progress indicator** while an agent step is running (agent name, phase).
- **Rendered previews** as variants complete.
- Interactive prompts the pipeline may ask (e.g. a form or a plan to approve) before continuing.

Sessions are resumable — the session id persists in the URL (`?session=`) so a page refresh
reconnects and re-hydrates the message history instead of losing the conversation.

## Output

Finished designs are saved as real `Design` records (with rendered preview files) and can be
opened directly in the [Designer](./designer) for manual refinement, just like any other design.

---
> Verified against v1.0.0
