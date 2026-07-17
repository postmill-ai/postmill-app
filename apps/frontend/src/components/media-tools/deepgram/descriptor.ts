import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';
import { DeepgramPanel } from './deepgram-panel';

// Deepgram (registry/config identifier `deepgram`) is STT — it returns text, not a media
// artifact, so it can't ride the generic kit form/job pipeline. It uses the StudioShell
// chrome with a bespoke `custom` panel that calls the dedicated /media/deepgram backend.
// `operation` is required by the type but unused for a custom tab.
export const deepgramDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://deepgram.com",
    "tagline": "Enterprise speech-to-text at scale",
    "description": "An enterprise voice-AI platform delivering fast, accurate real-time and batch transcription via its Nova models — known for high-accuracy, low-cost speech-to-text and captions.",
    "badges": [
      "Transcription",
      "Audio"
    ],
    "highlights": [
      "Nova speech-to-text, real-time & batch",
      "Word-level timings for accurate captions",
      "Export .srt / .vtt / .txt or burn into video",
      "Smart formatting, punctuation & diarization",
      "Trusted by Twilio, IBM & Cloudflare"
    ]
  },
  provider: 'deepgram',
  title: 'Deepgram',
  tabs: [
    {
      key: 'transcribe',
      label: 'Transcribe',
      operation: 'audio',
      custom: DeepgramPanel,
      fields: [],
    },
  ],
};
