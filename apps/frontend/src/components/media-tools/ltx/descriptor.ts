import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// LTX Studio (Lightricks) official developer API. Field names are LTX's native params — they ride
// straight into the async submit body (see ltx.adapter.ts). The media-field names `image_uri` /
// `audio_uri` / `last_frame_uri` resolve to provider-reachable URLs server-side and ALSO route the
// endpoint: an audio source → audio-to-video, an image source → image-to-video, else text-to-video.
// All three tabs are `operation: 'video'`; the model id selects the LTX-2 / LTX-2.3 variant.

// Resolution rides as a native `WxH` string (per the LTX quickstart). 16:9 + 9:16 at 1080p/1440p/4K.
const RESOLUTIONS = [
  { value: '1920x1080', label: '1080p · 16:9' },
  { value: '1080x1920', label: '1080p · 9:16' },
  { value: '2560x1440', label: '1440p · 16:9' },
  { value: '1440x2560', label: '1440p · 9:16' },
  { value: '3840x2160', label: '4K · 16:9' },
  { value: '2160x3840', label: '4K · 9:16' },
];

// Camera motion is optional; '' (Auto) is dropped server-side.
const CAMERA_MOTION = [
  { value: '', label: 'Auto' },
  { value: 'static', label: 'Static' },
  { value: 'dolly_in', label: 'Dolly in' },
  { value: 'dolly_out', label: 'Dolly out' },
  { value: 'dolly_left', label: 'Dolly left' },
  { value: 'dolly_right', label: 'Dolly right' },
  { value: 'jib_up', label: 'Jib up' },
  { value: 'jib_down', label: 'Jib down' },
  { value: 'focus_shift', label: 'Focus shift' },
];

// LTX-2 (16:9 only) and LTX-2.3 (16:9 + 9:16) variants. Pro variants are required for audio-to-video.
const VIDEO_MODELS = [
  { value: 'ltx-2-3-pro', label: 'LTX-2.3 Pro' },
  { value: 'ltx-2-3-fast', label: 'LTX-2.3 Fast' },
  { value: 'ltx-2-pro', label: 'LTX-2 Pro' },
  { value: 'ltx-2-fast', label: 'LTX-2 Fast' },
];

const AUDIO_MODELS = [
  { value: 'ltx-2-3-pro', label: 'LTX-2.3 Pro' },
  { value: 'ltx-2-pro', label: 'LTX-2 Pro' },
];

export const ltxDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://ltx.studio",
    "tagline": "The AI platform for video production",
    "description": "LTX Studio by Lightricks is an end-to-end AI video production platform. Powered by the open-source LTX-2 model, it takes you from script to storyboard to finished video.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "LTX-2: open-source multimodal video model",
      "Text-to-video, image-to-video, audio-to-video",
      "AI storyboard generator from a script",
      "Character, location, and style consistency",
      "Timeline editing, camera control, sound design"
    ]
  },
  provider: 'ltx',
  title: 'LTX Studio',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video (with synchronized audio) from a text prompt with LTX-2.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'select', name: 'model', label: 'Model', default: 'ltx-2-3-pro', options: VIDEO_MODELS },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '1920x1080', options: RESOLUTIONS },
        { type: 'number', name: 'duration', label: 'Duration (seconds)', min: 1, max: 20, default: 8 },
        { type: 'number', name: 'fps', label: 'Frame rate (fps)', min: 24, max: 60, default: 24 },
        { type: 'select', name: 'camera_motion', label: 'Camera motion', default: '', options: CAMERA_MOTION },
        { type: 'toggle', name: 'generate_audio', label: 'Generate audio', help: 'Synthesize a synchronized soundtrack', default: true },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with LTX-2.',
      fields: [
        { type: 'media', name: 'image_uri', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
        { type: 'select', name: 'model', label: 'Model', default: 'ltx-2-3-pro', options: VIDEO_MODELS },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '1920x1080', options: RESOLUTIONS },
        { type: 'number', name: 'duration', label: 'Duration (seconds)', min: 1, max: 20, default: 8 },
        { type: 'number', name: 'fps', label: 'Frame rate (fps)', min: 24, max: 60, default: 24 },
        { type: 'select', name: 'camera_motion', label: 'Camera motion', default: '', options: CAMERA_MOTION },
        { type: 'media', name: 'last_frame_uri', label: 'Last frame (optional, LTX-2.3 only)', accept: 'image' },
        { type: 'toggle', name: 'generate_audio', label: 'Generate audio', help: 'Synthesize a synchronized soundtrack', default: true },
      ],
    },
    {
      key: 'audio-to-video',
      label: 'Audio → Video',
      operation: 'video',
      description: 'Generate visuals synchronized to an audio track (Pro models only).',
      fields: [
        { type: 'media', name: 'audio_uri', label: 'Audio track', accept: 'audio', required: true },
        { type: 'media', name: 'image_uri', label: 'Reference image (optional)', accept: 'image' },
        { type: 'prompt', name: 'prompt', label: 'Prompt (optional)', placeholder: 'Describe the visuals…' },
        { type: 'select', name: 'model', label: 'Model', default: 'ltx-2-3-pro', options: AUDIO_MODELS },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '1920x1080', options: RESOLUTIONS },
        { type: 'number', name: 'duration', label: 'Duration (seconds)', min: 1, max: 20, default: 8 },
      ],
    },
  ],
};
