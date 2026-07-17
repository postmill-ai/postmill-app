# Tavus

**Tavus** (`/media/tavus`) generates personalized talking videos from one of your Tavus replicas and a script. Its tagline is *“Real-time conversational video AI.”*

## Where to configure

Configure your Tavus API key under **Settings → Media**. You create replicas in the Tavus dashboard; copy the replica id into the studio. See [Settings](../settings) for credential setup.

## Tabs / operations

| Tab | Operation | Output | Key fields |
|---|---|---|---|
| **Replica Video** | Video | Talking-head MP4 | Replica id, script (prompt), optional video name. |

## Generation flow

Replica videos are **asynchronous**. After submission, the job appears in the Render Queue and tracks progress until the MP4 is ready. The finished video is saved to `/files` and can be opened in the [Designer](./index.md) or pre-filled in a post. For the shared queue and hand-off flow, see [Media Studios overview](./index.md).

## Caveats

- Completion is **webhook-first**, with the `media-jobs-poll` cron as a fallback.
- Tavus returns both a `hosted_url` (an HTML share page) and a `download_url` (the actual MP4). Postmill uses only the `download_url` so the file can be imported into `/files`.
- A replica id is required; the studio does not create replicas.

## Related docs

- [Media Studios overview](./index)
- [Media Library](../media-library)
- [Settings](../settings)

---
> Verified against v1.0.0
