import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Suno music generation via the sunoapi.org gateway (registry/config identifier `suno`).
// Audio-only, async: the adapter submits the generation and the render queue polls until the
// tracks are ready. Field names are native sunoapi.org params (style/title/instrumental/…) and
// ride straight into the request body. Suno returns TWO clips per generation — both land in your
// audio files as separate render-queue cards. customMode is enabled by the adapter only when both
// Style and Title are filled in (otherwise it submits a non-custom, prompt-only generation).
const MODEL_FIELD = {
  type: 'select' as const,
  name: 'model',
  label: 'Model',
  default: 'V5_5',
  options: [
    { value: 'V5_5', label: 'v5.5 (latest)' },
    { value: 'V5', label: 'v5' },
    { value: 'V4_5PLUS', label: 'v4.5+' },
    { value: 'V4_5', label: 'v4.5' },
    { value: 'V4', label: 'v4' },
  ],
};

export const sunoDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://sunoapi.org',
    tagline: 'Generate full songs from a prompt',
    description:
      'Suno is a leading generative-AI music model that turns a text prompt — or your own lyrics, style and title — into complete, studio-quality songs with vocals or instrumentals. This studio uses the sunoapi.org gateway.',
    badges: ['Music', 'Audio'],
    highlights: [
      'Full songs with vocals or instrumental-only',
      'Custom mode: bring your own lyrics, style and title',
      'Multiple model versions (v4 → v5.5)',
      'Two takes generated per prompt — keep your favourite',
      'Tracks land in your audio library, ready to post',
    ],
  },
  provider: 'suno',
  title: 'Suno',
  tabs: [
    {
      key: 'song',
      label: 'Song',
      operation: 'audio',
      description:
        'Generate a song with vocals. Add a Style and Title for custom mode, or just describe the song for a quick generation.',
      fields: [
        {
          type: 'prompt',
          name: 'prompt',
          label: 'Prompt / lyrics',
          required: true,
          placeholder: 'Describe the song, or paste your own lyrics…',
        },
        { type: 'text', name: 'style', label: 'Style', placeholder: 'e.g. dream pop, lo-fi, orchestral' },
        { type: 'text', name: 'title', label: 'Title', placeholder: 'Track title' },
        MODEL_FIELD,
        {
          type: 'select',
          name: 'vocalGender',
          label: 'Vocal gender',
          default: '',
          options: [
            { value: '', label: 'Auto' },
            { value: 'm', label: 'Male' },
            { value: 'f', label: 'Female' },
          ],
        },
        { type: 'number', name: 'styleWeight', label: 'Style weight', min: 0, max: 1, step: 0.05 },
        { type: 'toggle', name: 'instrumental', label: 'Instrumental only', default: false },
      ],
    },
    {
      key: 'instrumental',
      label: 'Instrumental',
      operation: 'audio',
      description: 'Generate an instrumental track (no vocals).',
      fields: [
        {
          type: 'prompt',
          name: 'prompt',
          label: 'Prompt',
          required: true,
          placeholder: 'Describe the instrumental…',
        },
        { type: 'text', name: 'style', label: 'Style', placeholder: 'e.g. cinematic, ambient, synthwave' },
        { type: 'text', name: 'title', label: 'Title', placeholder: 'Track title' },
        MODEL_FIELD,
        { type: 'number', name: 'styleWeight', label: 'Style weight', min: 0, max: 1, step: 0.05 },
        { type: 'toggle', name: 'instrumental', label: 'Instrumental only', default: true },
      ],
    },
  ],
};
