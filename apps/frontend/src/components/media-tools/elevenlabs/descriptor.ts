import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// ElevenLabs text-to-speech (registry/config identifier `elevenlabs`). TTS is synchronous —
// the adapter returns the audio inline as a data URL. Field names are native ElevenLabs
// params (voice_id + voice_settings), so they ride straight into the request body.
export const elevenlabsDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://elevenlabs.io",
    "tagline": "Lifelike AI voice generation & TTS",
    "description": "The leading AI audio platform for ultra-realistic text-to-speech, voice cloning, and multilingual dubbing across 70+ languages — known for the most natural-sounding AI voices available.",
    "badges": [
      "Voice",
      "Audio"
    ],
    "highlights": [
      "Lifelike text-to-speech in 70+ languages",
      "5,000+ voices, plus custom voice cloning",
      "Dubbing that preserves the speaker's emotion",
      "Scribe speech-to-text, music & SFX generation",
      "APIs, SDKs & multiple TTS models"
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
            { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (fast)' },
            { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (lowest latency)' },
            { value: 'eleven_monolingual_v1', label: 'English v1' },
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
  ],
};
