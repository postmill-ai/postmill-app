import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Wan (Tongyi Wanxiang) on Alibaba Cloud Model Studio (DashScope, intl host). Field names are the
// native DashScope params: `negative_prompt`/`img_url` ride into `input`, everything else (size,
// resolution, duration, n, prompt_extend, watermark) into `parameters` — see wan.adapter.ts. Model
// lists are curated (DashScope has no clean per-modality catalog for the task API); the combobox
// also accepts any typed model id, so newer Wan ids work without a code change.

const T2I_MODELS = [
  { value: 'wan2.2-t2i-flash', label: 'Wan 2.2 T2I Flash (fast)' },
  { value: 'wan2.2-t2i-plus', label: 'Wan 2.2 T2I Plus (quality)' },
  { value: 'wanx2.1-t2i-turbo', label: 'Wanx 2.1 T2I Turbo' },
  { value: 'wanx2.1-t2i-plus', label: 'Wanx 2.1 T2I Plus' },
];

const T2I_SIZE = [
  { value: '1280*1280', label: 'Square 1280×1280' },
  { value: '1024*1024', label: 'Square 1024×1024' },
  { value: '1280*720', label: 'Landscape 1280×720' },
  { value: '720*1280', label: 'Portrait 720×1280' },
  { value: '1440*810', label: 'Wide 1440×810' },
];

const T2V_MODELS = [
  { value: 'wan2.2-t2v-plus', label: 'Wan 2.2 T2V Plus' },
  { value: 'wan2.1-t2v-turbo', label: 'Wan 2.1 T2V Turbo (fast)' },
  { value: 'wan2.1-t2v-plus', label: 'Wan 2.1 T2V Plus' },
];

const T2V_SIZE = [
  { value: '1280*720', label: 'Landscape 1280×720' },
  { value: '720*1280', label: 'Portrait 720×1280' },
  { value: '960*960', label: 'Square 960×960' },
  { value: '1088*832', label: '4:3 1088×832' },
  { value: '832*1088', label: '3:4 832×1088' },
];

const I2V_MODELS = [
  { value: 'wan2.2-i2v-plus', label: 'Wan 2.2 I2V Plus' },
  { value: 'wan2.2-i2v-flash', label: 'Wan 2.2 I2V Flash (fast)' },
  { value: 'wan2.5-i2v-preview', label: 'Wan 2.5 I2V Preview' },
  { value: 'wan2.1-i2v-turbo', label: 'Wan 2.1 I2V Turbo' },
  { value: 'wan2.1-i2v-plus', label: 'Wan 2.1 I2V Plus' },
];

const I2V_RESOLUTION = [
  { value: '480P', label: '480P' },
  { value: '720P', label: '720P' },
  { value: '1080P', label: '1080P' },
];

export const wanDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://wan.video",
    "tagline": "Open AI video and image generation by Alibaba",
    "description": "Alibaba's Wan creative platform (Model Studio) lowers the barrier to content creation with the Wan2.x model family — spanning text-to-video, image-to-video, and text-to-image.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "Wan2.x text-to-video and image-to-video",
      "Text-to-image and image editing in one suite",
      "First-and-last-frame control for video",
      "Strong visual fidelity and motion consistency",
      "Open, large-scale generative video models"
    ]
  },
  provider: 'wan',
  title: 'Wan',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image from a text prompt with Alibaba Wan / Wanx.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'wan2.2-t2i-flash', options: T2I_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid…' },
        { type: 'select', name: 'size', label: 'Size', default: '1280*1280', options: T2I_SIZE },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 4, default: 1 },
        { type: 'toggle', name: 'prompt_extend', label: 'Prompt rewrite', help: 'Let the model expand your prompt', default: true },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with Wan 2.x.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'wan2.2-t2v-plus', options: T2V_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid…' },
        { type: 'select', name: 'size', label: 'Size', default: '1280*720', options: T2V_SIZE },
        { type: 'number', name: 'duration', label: 'Duration (s)', min: 3, max: 10, default: 5 },
        { type: 'toggle', name: 'prompt_extend', label: 'Prompt rewrite', help: 'Let the model expand your prompt', default: true },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with Wan 2.x.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'wan2.2-i2v-plus', options: I2V_MODELS },
        { type: 'media', name: 'img_url', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid…' },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '720P', options: I2V_RESOLUTION },
        { type: 'number', name: 'duration', label: 'Duration (s)', min: 3, max: 10, default: 5 },
      ],
    },
  ],
};
