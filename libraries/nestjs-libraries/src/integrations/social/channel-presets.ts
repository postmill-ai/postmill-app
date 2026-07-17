export interface SafeZoneOverlay {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
}

export interface ChannelPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  category: 'social' | 'story' | 'ad' | 'custom' | 'video';
  safeZones?: SafeZoneOverlay[];
  provider?: string | null;
  /** Target frame rate for video outputs (video presets only). */
  fps?: number;
  /** Hard duration cap in milliseconds for video outputs (video presets only). */
  maxDurationMs?: number;
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: 'ig-post', name: 'Instagram Post', width: 1080, height: 1080, category: 'social', provider: 'instagram' },
  {
    id: 'ig-story', name: 'Instagram Story', width: 1080, height: 1920, category: 'story', provider: 'instagram',
    safeZones: [
      { label: 'CTA Bar', x: 0, y: 1780, width: 1080, height: 140, description: 'CTA button bar at bottom' },
      { label: 'Top Safe Zone', x: 0, y: 0, width: 1080, height: 80, description: 'System UI at top' },
    ],
  },
  {
    id: 'ig-reel', name: 'Instagram Reel', width: 1080, height: 1920, category: 'story', provider: 'instagram',
    safeZones: [
      { label: 'Bottom UI', x: 0, y: 1720, width: 1080, height: 200, description: 'Caption, like, comment, share' },
      { label: 'Top Safe Zone', x: 0, y: 0, width: 1080, height: 120, description: 'Account info + actions' },
    ],
  },
  { id: 'fb-post', name: 'Facebook Post', width: 1200, height: 630, category: 'social', provider: 'facebook' },
  {
    id: 'fb-story', name: 'Facebook Story', width: 1080, height: 1920, category: 'story', provider: 'facebook',
    safeZones: [
      { label: 'CTA Bar', x: 0, y: 1780, width: 1080, height: 140, description: 'CTA button bar at bottom' },
    ],
  },
  { id: 'x-post', name: 'X (Twitter) Post', width: 1200, height: 675, category: 'social', provider: 'x' },
  { id: 'linkedin-post', name: 'LinkedIn Post', width: 1200, height: 627, category: 'social', provider: 'linkedin' },
  { id: 'linkedin-banner', name: 'LinkedIn Banner', width: 1584, height: 396, category: 'ad', provider: 'linkedin' },
  {
    id: 'tiktok', name: 'TikTok Video', width: 1080, height: 1920, category: 'story', provider: 'tiktok',
    safeZones: [
      { label: 'Bottom UI', x: 0, y: 1700, width: 1080, height: 220, description: 'Caption, like, comment, share, music' },
      { label: 'Top Safe Zone', x: 0, y: 0, width: 1080, height: 100, description: 'Creator info + actions' },
    ],
  },
  { id: 'yt-thumbnail', name: 'YouTube Thumbnail', width: 1280, height: 720, category: 'social', provider: 'youtube' },
  { id: 'pinterest-pin', name: 'Pinterest Pin', width: 1000, height: 1500, category: 'social', provider: 'pinterest' },
  { id: 'custom', name: 'Custom Size', width: 1080, height: 1080, category: 'custom', provider: null },
  // Video presets
  { id: 'reel', name: 'Instagram Reel (Video)', width: 1080, height: 1920, category: 'video', provider: 'instagram', fps: 30, maxDurationMs: 60000 },
  { id: 'short', name: 'YouTube Short', width: 1080, height: 1920, category: 'video', provider: 'youtube', fps: 30, maxDurationMs: 60000 },
  { id: 'tiktok-video', name: 'TikTok Video', width: 1080, height: 1920, category: 'video', provider: 'tiktok', fps: 30, maxDurationMs: 60000 },
  { id: 'feed-video-1x1', name: 'Feed Video (1:1)', width: 1080, height: 1080, category: 'video', provider: null, fps: 30, maxDurationMs: 60000 },
  { id: 'landscape-video', name: 'Landscape Video', width: 1920, height: 1080, category: 'video', provider: null, fps: 30, maxDurationMs: 60000 },
  { id: 'custom-video', name: 'Custom Video', width: 1080, height: 1920, category: 'video', provider: null, fps: 30, maxDurationMs: 60000 },
];
