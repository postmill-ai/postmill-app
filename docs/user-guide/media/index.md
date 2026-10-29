# Media Studios

`/media` is Postmill's collection of generative media tools. It is **tools only** — there is no
asset library inside it. Every tool either produces a new file or transcribes an existing one, and
every finished asset lands in the [Media Library](../media-library) at `/files`, which remains the
single place you browse, organise, and reuse everything you've generated or uploaded.

## Nav structure

The `/media` sidebar groups 46 tools into three sections, with a pinned **Render queue** link
(`/media/queue`) above them that lists renders in flight across every studio:

| Section | Contents |
|---|---|
| **Platform** (header-less, at the top) | [Designer](./designer) (manual Konva canvas/timeline editor) and [AI Designer](./ai-designer) (chat-driven canvas assistant). |
| **AI Media** | 38 generation studios, one per provider — text-to-image/video/audio models, AI avatar video, music, and more. |
| **Content Pack** | 6 stock browsers — Stock Photos, Stock Videos, Vectors, Stickers, Stock Audio, Icons. |

Only provider studios whose provider is configured **and** enabled appear in the sidebar and on
the `/media` index (which also offers Image/Video/Audio… filter chips once five or more studios
are connected). Opening an unconfigured studio's URL directly shows its landing screen with a
**Configure** link into **Settings → Content → AI Media**. Configure credentials once per
provider — no environment-variable fallback for any paid provider.

## The standard generation flow

Most provider studios in the **AI Media** section are built on a shared **Studio Kit**, so they
all work the same way:

1. **Pick a source asset (when the tool needs one)** — image-to-video, image-to-image, and similar
   operations open the **Media Selector**, which lets you choose a file already in `/files` (it
   validates the picked file matches the field's expected kind — image, video, or audio).
2. **Fill in the form** — prompt, model, and any provider-native parameters (resolution, duration,
   style, etc.). Required fields are marked; the **Generate** button stays disabled until they're
   filled.
3. **Generate** — the studio posts the job to the backend and the request appears in the
   **Render Queue**, a live panel docked to the right of the form.
4. **Track progress** — the Render Queue polls while any job is `pending`/`processing` and shows a
   status pill (Queued, Rendering, Ready, Failed). Image and audio/TTS generations from most
   providers complete synchronously and appear almost immediately; video generations typically run
   as background jobs.
5. **Land in Files** — a completed job's artifact is already saved into your media storage; the
   queue card shows an inline preview (image, video, or audio player).
6. **Hand off** — every completed image/video/audio card offers three buttons:
   - **Edit in Designer** — opens the artifact in the [Designer](./designer) in a new tab (images
     land on the static canvas, audio/video land on the video timeline).
   - **Copy Link** — copies the stored artifact's URL to the clipboard.
   - **Post** — opens the composer pre-filled with the artifact, ready to schedule.

### Two exceptions

Not every tool in `/media` follows the generation flow above:

- **Content Pack (stock) browsers** search a free or premium stock catalog and **save** a chosen
  result straight into `/files` — there's no generation, no render queue, and no Designer/Post
  handoff step baked into the search itself (a saved file can still be opened in Designer
  afterward like any other file).
- **[Deepgram](./deepgram)** transcribes speech to text. It returns `{ text, words, segments }`
  instead of a media file, so its render-queue card is a text card (Copy / To composer) with no
  preview and no Edit-in-Designer/Post buttons. Its one Designer handoff is different too: it can
  send a **video source plus its computed captions** into the Designer, which burns them in as a
  caption track without re-transcribing.

## Bespoke studios

A few tools have enough of a unique interaction model that they keep their own bespoke UI instead
of riding the generic Studio Kit form:

- **[Designer](./designer)** — the manual canvas/timeline editor itself, and the target of every
  "Edit in Designer" handoff.
- **[AI Designer](./ai-designer)** — a conversational agent that drives the Designer for you.
- **[HeyGen](./heygen)** — four structured tabs (Storyboard, Talking Photo, Translate, Voiceover)
  for AI avatar video, still landing in the same render queue / Files / Post pattern.
- **[Replicate](./replicate)** — a 19-category workspace (image, video, audio, STT, inpainting,
  merge, memes) with its own model picker, cost badges, and specialised editors (mask painter,
  clip merge, meme layers).
- **[Deepgram](./deepgram)** — speech-to-text and caption export, described above.

## All studios

**Platform:** [Designer](./designer) · [AI Designer](./ai-designer)

**AI Media:** [Replicate](./replicate) · [HeyGen](./heygen) · [Deepgram](./deepgram) · [Reel.Farm](./reelfarm) ·
[Genviral](./genviral) · [fal.ai](./fal) (`/media/fal`; the legacy `/media/kling` URL redirects here) ·
[Kling AI](./kling) (`/media/kling-ai`, the direct Kling API) · [Higgsfield](./higgsfield) ·
[LTX Studio](./ltx) · [Luma](./luma) · [MiniMax](./minimax) · [Pika](./pika) · [Qwen](./qwen) ·
[Together AI](./togetherai) · [Runway](./runway) · [Suno](./suno) · [Wan](./wan) ·
[SiliconFlow](./siliconflow) · [Groq](./groq) · [OpenRouter](./openrouter) ·
[Fireworks AI](./fireworks) · [DeepInfra](./deepinfra) · [xAI Grok](./xai) · [Vercel AI](./gateway) ·
[Amazon Bedrock](./bedrock) · [Azure OpenAI](./azure) · [Google AI Studio](./google-ai) ·
[Google Vertex](./vertex) · [Black Forest Labs](./black-forest-labs) · [Stability AI](./stability-ai) ·
[Recraft](./recraft) · [Ideogram](./ideogram) · [Leonardo.ai](./leonardo) · [OpenAI](./openai) ·
[ElevenLabs](./elevenlabs) · [D-ID](./did) · [Hedra](./hedra) · [Tavus](./tavus)

**Content Pack:** [Stock Photos](./stock-photos) · [Stock Videos](./stock-videos) ·
[Vectors](./stock-vectors) · [Stickers](./stock-stickers) · [Stock Audio](./stock-audio) ·
[Icons](./stock-icons)

Most provider studios are configured under **Settings → Content → AI Media** — see
[Settings](../settings) for credential setup. Some studios reuse a key you may already hold
elsewhere: the *universal-credential* studios (Qwen, Google AI Studio, Together AI, SiliconFlow,
Groq, OpenRouter, Fireworks AI, DeepInfra, Vercel AI, Amazon Bedrock, Azure OpenAI, xAI Grok) fall
back to the same key configured at **Settings → AI** when no media credential is stored, and Pika
rides another provider's credential entirely (your fal.ai key). Each studio's own page notes where
its credential lives.

---
> Verified against v1.4.0
