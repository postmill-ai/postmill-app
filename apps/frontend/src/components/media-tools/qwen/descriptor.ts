import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Qwen on Alibaba DashScope (registry/config identifier `qwen`). Field names are native
// DashScope params — the adapter routes prompt/negative_prompt/img_url into `input` and
// everything else into `parameters`. Qwen-Image completes synchronously (bounded poll);
// Wan2.x video is async (poll-cron completion). The key is shared with the Qwen LLM
// provider — configure it once at Settings → AI (or Settings → Media) and both work.
export const qwenDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://qwen.ai",
    "tagline": "Alibaba's Qwen image & Wan video models",
    "description": "Alibaba's Qwen family, served via DashScope / Model Studio — Qwen-Image generates native 2K images from long prompts, and Wan delivers text-to-video and image-to-video.",
    "badges": [
      "Image",
      "Video"
    ],
    "highlights": [
      "Qwen-Image: native 2K (2048px) image generation",
      "Wan video: text-to-video and image-to-video",
      "Handles long prompts up to ~1,000 tokens",
      "Served via DashScope / Alibaba Cloud Model Studio",
      "Strong cost-performance for pro-grade output"
    ]
  },
  provider: 'qwen',
  title: 'Qwen',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image from a text prompt with Qwen-Image.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'qwen-image-plus',
          options: [
            { value: 'qwen-image-plus', label: 'Qwen-Image Plus' },
            { value: 'qwen-image', label: 'Qwen-Image' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        {
          type: 'select',
          name: 'size',
          label: 'Size',
          default: '1328*1328',
          options: [
            { value: '1328*1328', label: 'Square 1:1 (1328×1328)' },
            { value: '1664*928', label: 'Landscape 16:9 (1664×928)' },
            { value: '928*1664', label: 'Portrait 9:16 (928×1664)' },
            { value: '1472*1140', label: 'Photo 4:3 (1472×1140)' },
            { value: '1140*1472', label: 'Photo 3:4 (1140×1472)' },
          ],
        },
        { type: 'toggle', name: 'prompt_extend', label: 'Prompt extend', help: 'Let Qwen enrich short prompts', default: true },
        { type: 'toggle', name: 'watermark', label: 'Watermark', default: false },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with Wan2.x.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'wan2.2-t2v-plus',
          options: [
            { value: 'wan2.2-t2v-plus', label: 'Wan 2.2 T2V Plus' },
            { value: 'wanx2.1-t2v-turbo', label: 'Wan 2.1 T2V Turbo (fast)' },
            { value: 'wanx2.1-t2v-plus', label: 'Wan 2.1 T2V Plus' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        {
          type: 'select',
          name: 'size',
          label: 'Resolution',
          default: '1280*720',
          help: '1080p variants require a Plus model.',
          options: [
            { value: '1280*720', label: 'Landscape 720p (1280×720)' },
            { value: '720*1280', label: 'Portrait 720p (720×1280)' },
            { value: '960*960', label: 'Square (960×960)' },
            { value: '1920*1080', label: 'Landscape 1080p (1920×1080)' },
            { value: '1080*1920', label: 'Portrait 1080p (1080×1920)' },
          ],
        },
        { type: 'number', name: 'duration', label: 'Duration (s)', min: 3, max: 10, step: 1, default: 5, help: 'Most Wan models render 5s.' },
        { type: 'toggle', name: 'prompt_extend', label: 'Prompt extend', default: true },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with Wan2.x.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'wan2.2-i2v-plus',
          options: [
            { value: 'wan2.2-i2v-plus', label: 'Wan 2.2 I2V Plus' },
            { value: 'wanx2.1-i2v-turbo', label: 'Wan 2.1 I2V Turbo (fast)' },
            { value: 'wanx2.1-i2v-plus', label: 'Wan 2.1 I2V Plus' },
          ],
        },
        { type: 'media', name: 'img_url', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'toggle', name: 'prompt_extend', label: 'Prompt extend', default: true },
      ],
    },
  ],
};
