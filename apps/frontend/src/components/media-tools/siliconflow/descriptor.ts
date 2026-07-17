import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// SiliconFlow — image (OpenAI-compatible), async video (Wan2.2 submit/poll), and TTS, on the
// org's existing SiliconFlow LLM key (universal-credential reuse). Field names are native
// SiliconFlow params; image models are discovered live, video/audio use curated lists.
const VIDEO_SIZES = [
  { value: '1280x720', label: 'Landscape 720p (1280×720)' },
  { value: '720x1280', label: 'Portrait 720p (720×1280)' },
  { value: '960x960', label: 'Square (960×960)' },
];

export const siliconflowDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://siliconflow.com",
    "tagline": "One API for all your AI inference needs",
    "description": "A lightning-fast inference platform serving 200+ open and commercial models — LLMs plus image, video, and audio — through a single OpenAI-compatible API with predictable pricing.",
    "badges": [
      "Image",
      "Video",
      "Audio"
    ],
    "highlights": [
      "200+ optimized LLM & multimodal models",
      "Image, video, and audio generation in one API",
      "Blazing-fast inference, high throughput",
      "Fully OpenAI-compatible — drop-in integration",
      "Predictable, fair pay-as-you-go pricing"
    ]
  },
  provider: 'siliconflow',
  title: 'SiliconFlow',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with FLUX, Z-Image and other SiliconFlow models.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'black-forest-labs/FLUX.1-schnell',
          options: [
            { value: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 [schnell]' },
            { value: 'black-forest-labs/FLUX.1-dev', label: 'FLUX.1 [dev]' },
            { value: 'Qwen/Qwen-Image', label: 'Qwen-Image' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        {
          type: 'select',
          name: 'image_size',
          label: 'Size',
          default: '1024x1024',
          options: [
            { value: '1024x1024', label: 'Square (1024×1024)' },
            { value: '1024x576', label: 'Landscape 16:9 (1024×576)' },
            { value: '576x1024', label: 'Portrait 9:16 (576×1024)' },
          ],
        },
        { type: 'number', name: 'num_inference_steps', label: 'Steps', min: 1, max: 50, step: 1 },
        { type: 'number', name: 'batch_size', label: 'Images', min: 1, max: 4, step: 1, default: 1 },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip with Wan2.x.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'Wan-AI/Wan2.2-T2V-A14B',
          options: [
            { value: 'Wan-AI/Wan2.2-T2V-A14B', label: 'Wan 2.2 T2V A14B' },
            { value: 'Wan-AI/Wan2.1-T2V-14B-720P-Turbo', label: 'Wan 2.1 T2V Turbo' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'select', name: 'image_size', label: 'Resolution', default: '1280x720', options: VIDEO_SIZES },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image with Wan2.x.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'Wan-AI/Wan2.2-I2V-A14B',
          options: [
            { value: 'Wan-AI/Wan2.2-I2V-A14B', label: 'Wan 2.2 I2V A14B' },
            { value: 'Wan-AI/Wan2.1-I2V-14B-720P-Turbo', label: 'Wan 2.1 I2V Turbo' },
          ],
        },
        { type: 'media', name: 'image', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        { type: 'select', name: 'image_size', label: 'Resolution', default: '1280x720', options: VIDEO_SIZES },
      ],
    },
    {
      key: 'text-to-speech',
      label: 'Text → Speech',
      operation: 'audio',
      description: 'Generate a voiceover with Fish-Speech / CosyVoice.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'fishaudio/fish-speech-1.5',
          options: [
            { value: 'fishaudio/fish-speech-1.5', label: 'Fish-Speech 1.5' },
            { value: 'FunAudioLLM/CosyVoice2-0.5B', label: 'CosyVoice2 0.5B' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Text', required: true, placeholder: 'Text to speak…' },
        { type: 'text', name: 'voice', label: 'Voice', placeholder: 'e.g. fishaudio/fish-speech-1.5:alex' },
        {
          type: 'select',
          name: 'response_format',
          label: 'Format',
          default: 'mp3',
          options: [
            { value: 'mp3', label: 'MP3' },
            { value: 'wav', label: 'WAV' },
          ],
        },
      ],
    },
  ],
};
