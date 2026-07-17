import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// MiniMax video (registry/config identifier `minimax`). Native params ride
// `options.input`; `first_frame_image`/`subject_image` are resolved to URLs and folded
// into MiniMax's request shape by the adapter.
export const minimaxDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://hailuoai.video",
    "tagline": "Turn your imagination into video",
    "description": "Hailuo, MiniMax's AI video generator, is known for striking cinematic motion and strong prompt following from text or a single image — with templates for dance, effects, and character animation.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "Cinematic motion with strong prompt adherence",
      "Text-to-video and image-to-video generation",
      "Templates: dance, transformations, characters",
      "Image generation and audio tools alongside video",
      "Fast, accessible creation for everyday creators"
    ]
  },
  provider: 'minimax',
  title: 'MiniMax',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with MiniMax Hailuo.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'video-01',
          options: [
            { value: 'video-01', label: 'Hailuo T2V-01' },
            { value: 'T2V-01-Director', label: 'T2V-01 Director (camera control)' },
          ],
        },
        {
          type: 'prompt',
          name: 'prompt',
          label: 'Prompt',
          required: true,
          placeholder: 'Describe the scene… Director model supports [Pan left], [Zoom in], etc.',
        },
        { type: 'toggle', name: 'prompt_optimizer', label: 'Prompt optimizer', help: 'Let MiniMax refine the prompt', default: true },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with MiniMax.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'I2V-01',
          options: [
            { value: 'I2V-01', label: 'Hailuo I2V-01' },
            { value: 'I2V-01-Director', label: 'I2V-01 Director (camera control)' },
            { value: 'I2V-01-live', label: 'I2V-01 Live (anime/illustration)' },
          ],
        },
        { type: 'media', name: 'first_frame_image', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        { type: 'toggle', name: 'prompt_optimizer', label: 'Prompt optimizer', default: true },
      ],
    },
    {
      key: 'subject-reference',
      label: 'Subject Reference',
      operation: 'video',
      model: 'S2V-01',
      description: 'Generate a video that keeps a reference character consistent (MiniMax S2V-01).',
      fields: [
        { type: 'media', name: 'subject_image', label: 'Subject image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene with your subject…' },
        { type: 'toggle', name: 'prompt_optimizer', label: 'Prompt optimizer', default: true },
      ],
    },
  ],
};
