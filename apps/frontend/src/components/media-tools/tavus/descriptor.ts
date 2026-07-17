import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Tavus replica video (registry/config identifier `tavus`). A pre-trained replica id + a
// script produce a personalized talking video; completion arrives via webhook (poll-cron
// fallback). Replicas are created in the Tavus dashboard — paste the id here.
export const tavusDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://www.tavus.io",
    "tagline": "Real-time conversational video AI",
    "description": "Tavus builds foundational models for face-to-face AI — real-time video replicas and conversational agents that see, hear, and respond with emotion, via its Phoenix rendering and CVI APIs.",
    "badges": [
      "Avatar",
      "Video"
    ],
    "highlights": [
      "Phoenix-4 real-time human rendering with emotion",
      "Raven-1 perception reads expression & tone",
      "Sparrow-1 enables natural conversational turns",
      "CVI APIs to build interactive video agents",
      "Enterprise-trusted (Deloitte, Amazon, Salesforce)"
    ]
  },
  provider: 'tavus',
  title: 'Tavus',
  tabs: [
    {
      key: 'replica-video',
      label: 'Replica Video',
      operation: 'video',
      description: 'Generate a talking video from one of your Tavus replicas and a script.',
      fields: [
        {
          type: 'text',
          name: 'replica_id',
          label: 'Replica id',
          required: true,
          placeholder: 'r1a2b3c4…',
          help: 'The id of a replica you created in the Tavus dashboard.',
        },
        { type: 'prompt', name: 'prompt', label: 'Script', required: true, placeholder: 'What should the replica say?' },
        { type: 'text', name: 'video_name', label: 'Video name (optional)', placeholder: 'Launch announcement' },
      ],
    },
  ],
};
