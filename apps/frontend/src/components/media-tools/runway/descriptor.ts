import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Runway (registry/config identifier `runway`). Field names are native Runway params;
// `promptImage` is the i2v source image. Runway has no callback, so renders complete via
// the poll cron / on-read poll.
export const runwayDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://runwayml.com",
    "tagline": "Cinematic AI video, built to simulate the world",
    "description": "A pioneering generative-AI platform whose Gen-4 family produces cinematic, high-fidelity video from text and images — prized for consistent characters, scenes, and director-grade motion control.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "Gen-4 models: state-of-the-art motion & adherence",
      "Text-to-video and image-to-video generation",
      "Consistent characters, scenes, and objects",
      "Camera and motion controls for cinematic results",
      "Trusted by filmmakers and creative studios"
    ]
  },
  provider: 'runway',
  title: 'Runway',
  tabs: [
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with Runway Gen-4.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'gen4_turbo',
          options: [
            { value: 'gen4_turbo', label: 'Gen-4 Turbo' },
            { value: 'gen3a_turbo', label: 'Gen-3 Alpha Turbo' },
          ],
        },
        { type: 'media', name: 'promptImage', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        {
          type: 'select',
          name: 'duration',
          label: 'Duration',
          default: '5',
          options: [
            { value: '5', label: '5 seconds' },
            { value: '10', label: '10 seconds' },
          ],
        },
        {
          type: 'select',
          name: 'ratio',
          label: 'Ratio',
          default: '1280:720',
          options: [
            { value: '1280:720', label: 'Landscape 1280×720' },
            { value: '720:1280', label: 'Portrait 720×1280' },
            { value: '960:960', label: 'Square 960×960' },
            { value: '1584:672', label: 'Wide 1584×672' },
          ],
        },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      model: 'gen4_image',
      description: 'Generate a still image from a text prompt with Runway Gen-4.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'ratio',
          label: 'Ratio',
          default: '1360:768',
          options: [
            { value: '1360:768', label: 'Landscape 1360×768' },
            { value: '768:1360', label: 'Portrait 768×1360' },
            { value: '1024:1024', label: 'Square 1024×1024' },
            { value: '1920:1080', label: 'Wide 1920×1080' },
            { value: '1080:1920', label: 'Tall 1080×1920' },
          ],
        },
      ],
    },
  ],
};
