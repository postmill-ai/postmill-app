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
  /** Approximate unsafe platform UI rectangles in these reference pixels. */
  safeZones?: SafeZoneOverlay[];
  /** Feed guides can stay layout-neutral; new real overlays may retain generic margins. */
  safeZoneLayout?: 'guide-only' | 'preserve-generic-margins';
  provider?: string | null;
  /** Target frame rate for video outputs (video presets only). */
  fps?: number;
  /** Hard duration cap in milliseconds for video outputs (video presets only). */
  maxDurationMs?: number;
}

const feedZones = (
  width: number,
  height: number,
  headerHeight: number,
  actionsHeight: number
): SafeZoneOverlay[] => [
  { label: 'Feed Header', x: 0, y: 0, width, height: headerHeight, description: 'Account and feed controls' },
  { label: 'Feed Actions', x: 0, y: height - actionsHeight, width, height: actionsHeight, description: 'Caption and engagement controls' },
];

const verticalVideoZones = (topHeight: number): SafeZoneOverlay[] => [
  { label: 'Top UI', x: 0, y: 0, width: 1080, height: topHeight, description: 'Account information and system controls' },
  { label: 'Action Rail', x: 900, y: 850, width: 180, height: 600, description: 'Like, comment, share and other action buttons' },
  { label: 'Bottom UI', x: 0, y: 1450, width: 1080, height: 470, description: 'Caption, audio and engagement controls' },
];

const REEL_SAFE_ZONES = verticalVideoZones(120);
const TIKTOK_SAFE_ZONES = verticalVideoZones(100);
const SHORT_SAFE_ZONES = verticalVideoZones(120);

export const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    id: 'ig-post', name: 'Instagram Post', width: 1080, height: 1080, category: 'social', provider: 'instagram',
    safeZoneLayout: 'guide-only',
    safeZones: feedZones(1080, 1080, 120, 160),
  },
  {
    id: 'ig-portrait', name: 'Instagram Portrait', width: 1080, height: 1350, category: 'social', provider: 'instagram',
    safeZones: [
      { label: 'Feed Header', x: 0, y: 0, width: 1080, height: 120, description: 'Account and feed controls' },
      { label: 'Feed Actions', x: 0, y: 1190, width: 1080, height: 160, description: 'Caption and engagement controls' },
    ],
  },
  {
    id: 'ig-story', name: 'Instagram Story', width: 1080, height: 1920, category: 'story', provider: 'instagram',
    safeZones: [
      { label: 'CTA Bar', x: 0, y: 1780, width: 1080, height: 140, description: 'CTA button bar at bottom' },
      { label: 'Top UI', x: 0, y: 0, width: 1080, height: 80, description: 'System UI at top' },
    ],
  },
  {
    id: 'ig-reel', name: 'Instagram Reel', width: 1080, height: 1920, category: 'story', provider: 'instagram',
    safeZones: REEL_SAFE_ZONES,
  },
  {
    id: 'fb-post', name: 'Facebook Post', width: 1200, height: 630, category: 'social', provider: 'facebook',
    safeZoneLayout: 'guide-only',
    safeZones: feedZones(1200, 630, 90, 130),
  },
  {
    id: 'fb-square', name: 'Facebook Square', width: 1080, height: 1080, category: 'social', provider: 'facebook',
    safeZones: [
      { label: 'Feed Header', x: 0, y: 0, width: 1080, height: 120, description: 'Account and feed controls' },
      { label: 'Feed Actions', x: 0, y: 920, width: 1080, height: 160, description: 'Caption and engagement controls' },
    ],
  },
  {
    id: 'fb-portrait', name: 'Facebook Portrait', width: 1080, height: 1350, category: 'social', provider: 'facebook',
    safeZones: [
      { label: 'Feed Header', x: 0, y: 0, width: 1080, height: 120, description: 'Account and feed controls' },
      { label: 'Feed Actions', x: 0, y: 1190, width: 1080, height: 160, description: 'Caption and engagement controls' },
    ],
  },
  {
    id: 'fb-story', name: 'Facebook Story', width: 1080, height: 1920, category: 'story', provider: 'facebook',
    safeZones: [
      { label: 'Profile and System UI', x: 0, y: 0, width: 1080, height: 140, description: 'Profile photo, account name and system controls' },
      { label: 'CTA Bar', x: 0, y: 1780, width: 1080, height: 140, description: 'CTA button bar at bottom' },
    ],
  },
  {
    id: 'x-post', name: 'X (Twitter) Post', width: 1200, height: 675, category: 'social', provider: 'x',
    safeZoneLayout: 'guide-only',
    safeZones: feedZones(1200, 675, 80, 140),
  },
  {
    id: 'linkedin-post', name: 'LinkedIn Post', width: 1200, height: 627, category: 'social', provider: 'linkedin',
    safeZoneLayout: 'guide-only',
    safeZones: feedZones(1200, 627, 90, 130),
  },
  {
    id: 'linkedin-square', name: 'LinkedIn Square', width: 1080, height: 1080, category: 'social', provider: 'linkedin',
    safeZones: [
      { label: 'Feed Header', x: 0, y: 0, width: 1080, height: 120, description: 'Account and feed controls' },
      { label: 'Feed Actions', x: 0, y: 920, width: 1080, height: 160, description: 'Caption and engagement controls' },
    ],
  },
  {
    id: 'linkedin-portrait', name: 'LinkedIn Portrait', width: 1080, height: 1350, category: 'social', provider: 'linkedin',
    safeZones: [
      { label: 'Feed Header', x: 0, y: 0, width: 1080, height: 120, description: 'Account and feed controls' },
      { label: 'Feed Actions', x: 0, y: 1190, width: 1080, height: 160, description: 'Caption and engagement controls' },
    ],
  },
  {
    id: 'threads-portrait', name: 'Threads Portrait', width: 1080, height: 1350, category: 'social', provider: 'threads',
    safeZones: [
      { label: 'Feed Header', x: 0, y: 0, width: 1080, height: 120, description: 'Account and feed controls' },
      { label: 'Feed Actions', x: 0, y: 1190, width: 1080, height: 160, description: 'Caption and engagement controls' },
    ],
  },
  {
    id: 'linkedin-banner', name: 'LinkedIn Banner', width: 1584, height: 396, category: 'ad', provider: 'linkedin',
    safeZoneLayout: 'preserve-generic-margins',
    safeZones: [
      { label: 'Profile Photo', x: 0, y: 176, width: 400, height: 220, description: 'Profile photo and account identity area' },
    ],
  },
  {
    id: 'tiktok', name: 'TikTok Video', width: 1080, height: 1920, category: 'story', provider: 'tiktok',
    safeZones: TIKTOK_SAFE_ZONES,
  },
  {
    id: 'yt-thumbnail', name: 'YouTube Thumbnail', width: 1280, height: 720, category: 'social', provider: 'youtube',
    safeZoneLayout: 'preserve-generic-margins',
    safeZones: [
      { label: 'Duration Timestamp', x: 1060, y: 640, width: 220, height: 80, description: 'Video duration timestamp corner' },
    ],
  },
  {
    id: 'pinterest-pin', name: 'Pinterest Pin', width: 1000, height: 1500, category: 'social', provider: 'pinterest',
    safeZoneLayout: 'preserve-generic-margins',
    safeZones: [
      { label: 'Save and More Actions', x: 760, y: 0, width: 240, height: 140, description: 'Save button and additional actions' },
      { label: 'Source and Destination', x: 0, y: 1370, width: 1000, height: 130, description: 'Source, destination and engagement controls' },
    ],
  },
  { id: 'custom', name: 'Custom Size', width: 1080, height: 1080, category: 'custom', provider: null },
  // Video presets
  {
    id: 'reel', name: 'Instagram Reel (Video)', width: 1080, height: 1920, category: 'video', provider: 'instagram', fps: 30, maxDurationMs: 60000,
    safeZoneLayout: 'preserve-generic-margins',
    safeZones: REEL_SAFE_ZONES,
  },
  {
    id: 'short', name: 'YouTube Short', width: 1080, height: 1920, category: 'video', provider: 'youtube', fps: 30, maxDurationMs: 60000,
    safeZoneLayout: 'preserve-generic-margins',
    safeZones: SHORT_SAFE_ZONES,
  },
  {
    id: 'tiktok-video', name: 'TikTok Video', width: 1080, height: 1920, category: 'video', provider: 'tiktok', fps: 30, maxDurationMs: 60000,
    safeZoneLayout: 'preserve-generic-margins',
    safeZones: TIKTOK_SAFE_ZONES,
  },
  { id: 'feed-video-1x1', name: 'Feed Video (1:1)', width: 1080, height: 1080, category: 'video', provider: null, fps: 30, maxDurationMs: 60000 },
  { id: 'landscape-video', name: 'Landscape Video', width: 1920, height: 1080, category: 'video', provider: null, fps: 30, maxDurationMs: 60000 },
  { id: 'custom-video', name: 'Custom Video', width: 1080, height: 1920, category: 'video', provider: null, fps: 30, maxDurationMs: 60000 },
];
