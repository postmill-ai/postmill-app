import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

// ElevenLabs (registry/config identifier `elevenlabs`). TTS is synchronous — the adapter
// returns the audio inline as a data URL. Image & Video use the async Flows API
// (submit → poll; requires an ElevenLabs Pro plan): images complete inside the request
// via bounded inline polling, videos land via the media-jobs poll cron. Field names are
// native ElevenLabs params (voice_id + voice_settings for TTS; aspect_ratio / resolution /
// duration_secs / generate_audio for Flows), so they ride straight into the request body.
// Veo frame/reference Files are converted to inline_base64 objects by the adapter; the
// descriptor's synthetic reference_image_N fields carry the role alongside each image.
export const elevenlabsDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://elevenlabs.io",
    "tagline": "Lifelike AI voice, image & video generation",
    "description": "The leading AI audio platform for ultra-realistic text-to-speech, voice cloning, and multilingual dubbing across 70+ languages — plus image and video generation (Gemini, GPT Image, Veo) via the Flows API on Pro plans.",
    "badges": [
      "Voice",
      "Audio",
      "Image",
      "Video"
    ],
    "highlights": [
      "Lifelike text-to-speech in 70+ languages",
      "5,000+ voices, plus custom voice cloning",
      "Image generation (Gemini & GPT Image models)",
      "Veo 3.1 text/image-to-video with frames, references & native audio",
      "Dubbing that preserves the speaker's emotion"
    ]
  },
  provider: 'elevenlabs',
  title: 'ElevenLabs',
  tabs: [
    {
      key: 'text-to-speech',
      label: 'Text → Speech',
      operation: 'audio',
      description: 'Generate a natural voiceover from text. The clip lands in your audio files.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Text', required: true, placeholder: 'Type the script to voice…' },
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'eleven_multilingual_v2',
          options: [
            { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (quality)' },
            { value: 'eleven_v3', label: 'Eleven v3 (expressive)' },
            { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (lowest latency)' },
            { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (legacy — use Flash)' },
          ],
        },
        {
          type: 'select',
          name: 'voice_id',
          label: 'Voice',
          default: '21m00Tcm4TlvDq8ikWAM',
          help: 'ElevenLabs premade voices.',
          options: [
            { value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (calm, narration)' },
            { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah (soft, news)' },
            { value: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi (strong, confident)' },
            { value: 'ErXwobaYiN019PkySvjV', label: 'Antoni (warm, well-rounded)' },
            { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (deep, narration)' },
            { value: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh (deep, young)' },
            { value: 'VR6AewLTigWG4xSOukaG', label: 'Arnold (crisp, strong)' },
            { value: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam (raspy, casual)' },
          ],
        },
        { type: 'number', name: 'stability', label: 'Stability', min: 0, max: 1, step: 0.05, default: 0.5 },
        { type: 'number', name: 'similarity_boost', label: 'Similarity boost', min: 0, max: 1, step: 0.05, default: 0.75 },
        { type: 'number', name: 'style', label: 'Style exaggeration', min: 0, max: 1, step: 0.05, default: 0 },
        { type: 'toggle', name: 'use_speaker_boost', label: 'Speaker boost', default: true },
      ],
    },
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image from a text prompt with Gemini image models. Requires an ElevenLabs Pro plan.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'gemini-3.1-flash-image',
          options: [
            { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image (fast)' },
            { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image (quality)' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '16:9',
          options: [
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
            { value: '1:1', label: 'Square 1:1' },
            { value: '4:3', label: 'Classic 4:3' },
            { value: '3:4', label: 'Portrait 3:4' },
          ],
        },
        {
          type: 'select',
          name: 'resolution',
          label: 'Resolution',
          default: '1K',
          options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
          ],
        },
      ],
    },
    {
      key: 'gpt-image',
      label: 'Text → Image (GPT)',
      operation: 'image',
      description: 'Generate a still image with OpenAI GPT Image models. Requires an ElevenLabs Pro plan.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'gpt-image-2',
          options: [
            { value: 'gpt-image-2', label: 'GPT Image 2' },
            { value: 'gpt-image-1', label: 'GPT Image 1' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '1:1',
          options: [
            { value: '1:1', label: 'Square 1:1' },
            { value: '3:2', label: 'Landscape 3:2' },
            { value: '2:3', label: 'Portrait 2:3' },
          ],
        },
        {
          type: 'select',
          name: 'quality',
          label: 'Quality',
          default: 'medium',
          options: [
            { value: 'low', label: 'Low (fast, cheap)' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ],
        },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a short video clip from a text prompt with Google Veo 3.1. Requires an ElevenLabs Pro plan; clips take a few minutes and land in the render queue.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'veo-3.1-fast-generate-001',
          options: [
            { value: 'veo-3.1-fast-generate-001', label: 'Veo 3.1 Fast' },
            { value: 'veo-3.1-generate-001', label: 'Veo 3.1 (quality)' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'number', name: 'duration_secs', label: 'Duration (s)', min: 4, max: 8, step: 2, default: 8, help: 'Veo renders 4, 6, or 8 seconds.' },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '16:9',
          options: [
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
          ],
        },
        {
          type: 'select',
          name: 'resolution',
          label: 'Resolution',
          default: '720p',
          options: [
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
            { value: '4K', label: '4K' },
          ],
        },
        { type: 'toggle', name: 'generate_audio', label: 'Generate audio', default: true, help: 'Veo can synthesize a native soundtrack.' },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Guide Veo 3.1 with start/end frames or up to three subject/style references. References require 8 seconds and cannot be combined with frames. Requires an ElevenLabs Pro plan.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'veo-3.1-fast-generate-001',
          options: [
            { value: 'veo-3.1-fast-generate-001', label: 'Veo 3.1 Fast' },
            { value: 'veo-3.1-generate-001', label: 'Veo 3.1 (quality)' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion and scene…' },
        { type: 'number', name: 'duration_secs', label: 'Duration (s)', min: 4, max: 8, step: 2, default: 8, help: 'Frames allow 4, 6, or 8 seconds. Subject/style references require 8 seconds.' },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '16:9',
          options: [
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
          ],
        },
        {
          type: 'select',
          name: 'resolution',
          label: 'Resolution',
          default: '720p',
          options: [
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
            { value: '4K', label: '4K' },
          ],
        },
        { type: 'toggle', name: 'generate_audio', label: 'Generate audio', default: true, help: 'Veo can synthesize a native soundtrack.' },
        { type: 'media', name: 'start_frame', label: 'Start frame', accept: 'image', help: 'Optional first frame. Required when using an end frame.' },
        { type: 'media', name: 'end_frame', label: 'End frame', accept: 'image', help: 'Optional last frame; cannot be combined with subject/style references.' },
        { type: 'media', name: 'reference_image_1', label: 'Reference image 1', accept: 'image', help: 'Optional subject or style reference. Inline images must be 25 MB or smaller.' },
        {
          type: 'select',
          name: 'reference_image_1_role',
          label: 'Reference 1 role',
          default: 'subject',
          options: [
            { value: 'subject', label: 'Subject / scene' },
            { value: 'style', label: 'Visual style' },
          ],
        },
        { type: 'media', name: 'reference_image_2', label: 'Reference image 2', accept: 'image' },
        {
          type: 'select',
          name: 'reference_image_2_role',
          label: 'Reference 2 role',
          default: 'subject',
          options: [
            { value: 'subject', label: 'Subject / scene' },
            { value: 'style', label: 'Visual style' },
          ],
        },
        { type: 'media', name: 'reference_image_3', label: 'Reference image 3', accept: 'image' },
        {
          type: 'select',
          name: 'reference_image_3_role',
          label: 'Reference 3 role',
          default: 'subject',
          options: [
            { value: 'subject', label: 'Subject / scene' },
            { value: 'style', label: 'Visual style' },
          ],
        },
      ],
    },
  ],
};
