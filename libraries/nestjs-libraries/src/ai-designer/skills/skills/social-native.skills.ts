import { defineSkill } from '../define-skill';

/**
 * Social-native genres — formats that exist because a platform exists.
 *
 * These are the ones where platform grammar beats general design sense: a
 * YouTube thumbnail that follows poster conventions loses to one that follows
 * thumbnail conventions, however much better designed it is.
 */

export const QuoteCardSkill = defineSkill({
  id: 'quote-card',
  title: 'Quote Card',
  signals: ['quote', 'saying', 'wisdom', 'motivational', 'inspire', 'said'],
  direction:
    'Aim at a book jacket, not a greetings card. The words carry it: a serif at generous size, wide leading, ample margin, no photograph competing. An oversized quotation mark is the only ornament worth having.',
  rules: [
    'Set the quote at the largest size that still leaves a comfortable margin — quote cards fail by cramming.',
    'Attribute it. An unattributed quote reads as invented.',
    'Never place a quote over a busy photograph. A flat ground or a heavily-treated image only.',
    'Line breaks are editorial: break on sense, not on where the box happens to run out.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'attribution', role: 'subhead', kind: 'text' },
    { id: 'decor', role: 'decor', kind: 'accent-shape' },
    { id: 'logo', role: 'logo', kind: 'logo' },
  ],
  art: {
    compositions: ['type-dominant', 'minimal-centered', 'centred-emblem'],
    effects: ['letterpress', 'keyline'],
    treatments: ['mono-tint', 'faded-matte', 'duotone-brand'],
    decor: ['quote-marks', 'short-rule', 'rule'],
  },
  criteria: [
    { name: 'typographic_quality', description: 'Sensible breaks, generous leading, real margin', weight: 0.3 },
    { name: 'attribution', description: 'The speaker is credited', weight: 0.15 },
  ],
});

export const CarouselCoverSkill = defineSkill({
  id: 'carousel-cover',
  title: 'Carousel Cover',
  signals: ['carousel', 'swipe', 'slide one', 'thread', 'series'],
  direction:
    'Aim at a magazine contents page: it must promise something specific enough to be worth swiping for. A number ("5 ways...") and a swipe cue are the two mechanics that work; everything else is decoration.',
  rules: [
    'Promise something countable and concrete. "Tips for growth" loses to "5 pricing mistakes".',
    'Include a swipe affordance — a chevron or arrow at the trailing edge.',
    'Leave the trailing edge clear of copy: the platform draws its own affordance there.',
    'The cover carries the promise, not the content. Do not try to fit slide two onto slide one.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'decor', role: 'decor', kind: 'accent-shape' },
  ],
  art: {
    compositions: ['type-dominant', 'hero-fullbleed', 'stacked-thirds', 'overlap-card'],
    effects: ['sticker-outline', 'hard-shadow', 'soft-lift'],
    treatments: ['duotone-brand', 'contrast-punch'],
    decor: ['chevron', 'rule', 'corner-brackets'],
  },
  criteria: [
    { name: 'swipe_promise', description: 'A concrete, countable promise', weight: 0.3 },
    { name: 'swipe_cue', description: 'A visible affordance to continue', weight: 0.15 },
  ],
});

export const StoryCoverSkill = defineSkill({
  id: 'story-cover',
  title: 'Story / Reel Cover',
  signals: ['story', 'reel', 'tiktok', 'vertical', 'shorts', 'cover'],
  direction:
    'Aim at a title card seen for half a second while a thumb is already moving. Vertical, centred, enormous type in the middle third — the top and bottom belong to the platform and anything placed there is gone.',
  rules: [
    'Vertical title-card type is condensed: textScaleX 0.6-0.75 on the middle-third headline.',
    'All copy lives in the middle third. The top and bottom fifths are platform chrome.',
    'One idea. A story cover with two messages communicates neither.',
    'Type large enough to read while scrolling: at least a tenth of the canvas height for the headline.',
    'High contrast is mandatory — these are viewed one-handed in daylight.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'type-dominant', 'stacked-thirds'],
    effects: ['legibility-halo', 'sticker-pop', 'hard-shadow', 'gradient-headline'],
    treatments: ['contrast-punch', 'moody-dark', 'soft-backdrop'],
    decor: ['none', 'chevron'],
  },
  criteria: [
    { name: 'safe_zone', description: 'Nothing important in the top or bottom fifth', weight: 0.3 },
    { name: 'thumb_stopping', description: 'Reads in half a second at arm’s length', weight: 0.2 },
  ],
});

export const YoutubeThumbnailSkill = defineSkill({
  id: 'youtube-thumbnail',
  title: 'YouTube Thumbnail',
  signals: ['thumbnail', 'youtube', 'video cover', 'preview image'],
  direction:
    'Aim at a tabloid front page, not a poster. Three or four words maximum at enormous weight, a face with a readable expression, and saturated contrast. This genre rewards obviousness — subtlety is invisible at 168 pixels wide.',
  rules: [
    'Tabloid type is condensed and shouted: textScaleX 0.62-0.75, textTransform "uppercase" — never a long word at a small size.',
    'Three to four words. Five is too many; a sentence is invisible.',
    'If a person appears, crop tight enough that the expression reads at thumbnail size.',
    'Outline or halo the type. Thumbnails sit on unpredictable backgrounds in the sidebar.',
    'Bottom-right is covered by the duration badge — keep it clear.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'banner-strip', 'overlap-card'],
    effects: ['sticker-pop', 'hard-shadow', 'neon-glow', 'legibility-halo'],
    treatments: ['contrast-punch', 'bleach', 'duotone-brand'],
    masks: ['subject-knockout'],
    decor: ['burst', 'chevron', 'none'],
  },
  criteria: [
    { name: 'thumbnail_legibility', description: 'Readable at 168px wide', weight: 0.35 },
    { name: 'badge_clearance', description: 'Bottom-right kept clear of the duration badge', weight: 0.15 },
  ],
});

export const PodcastEpisodeSkill = defineSkill({
  id: 'podcast-episode',
  title: 'Podcast Episode',
  signals: ['podcast', 'episode', 'listen', 'audio', 'ep'],
  direction:
    'Aim at a record sleeve. Square, a strong central mark or portrait, episode number treated as typography rather than metadata. Consistency across episodes matters more than novelty in any one.',
  rules: [
    'The episode number can sit on a radial-glow ground (effect radial-glow) like a lit record sleeve.',
    'The episode number is a design element — set it deliberately, not as a caption.',
    'Guest name and episode title are the two facts that matter; the show name is a constant and can be small.',
    'Keep a fixed zone for the number so a series reads as a series.',
    'A portrait crops to a circle or a squircle; a square-cropped face reads as a mugshot.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'guest', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'logo', role: 'logo', kind: 'logo' },
  ],
  art: {
    compositions: ['split-panel', 'centred-emblem', 'overlap-card', 'poster-frame'],
    effects: ['soft-lift', 'keyline', 'gradient-sheen', 'radial-glow'],
    treatments: ['duotone-brand', 'mono-tint', 'moody-dark'],
    masks: ['circle', 'squircle', 'arch'],
    decor: ['rule', 'short-rule'],
  },
  criteria: [
    { name: 'series_consistency', description: 'Episode number is placed as a repeatable element', weight: 0.2 },
  ],
});

export const ProfileBannerSkill = defineSkill({
  id: 'profile-banner',
  title: 'Profile Banner',
  signals: ['banner', 'header image', 'cover photo', 'profile header'],
  direction:
    'Aim at a shopfront fascia. Wide, calm, and built around an avatar that will be punched out of it — the composition has to survive a circular hole near one edge. Restraint is not optional here; a busy banner makes every profile below it look cluttered.',
  rules: [
    'Keep the avatar zone clear — the lower-left on most platforms.',
    'Crops vary wildly by device. Keep everything important in the central band.',
    'One line of copy at most. A banner is a backdrop, not a billboard.',
    'Avoid fine detail: banners are downscaled aggressively.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'logo', role: 'logo', kind: 'logo' },
  ],
  art: {
    compositions: ['banner-strip', 'hero-fullbleed', 'type-dominant'],
    effects: ['soft-lift', 'gradient-sheen'],
    treatments: ['soft-backdrop', 'duotone-brand', 'faded-matte'],
    decor: ['none', 'rule', 'dot-grid'],
  },
  criteria: [
    { name: 'crop_safety', description: 'Survives aggressive cropping on any device', weight: 0.3 },
    { name: 'avatar_clearance', description: 'The avatar zone stays clear', weight: 0.2 },
  ],
});

export const SOCIAL_NATIVE_SKILLS = [
  QuoteCardSkill,
  CarouselCoverSkill,
  StoryCoverSkill,
  YoutubeThumbnailSkill,
  PodcastEpisodeSkill,
  ProfileBannerSkill,
];
