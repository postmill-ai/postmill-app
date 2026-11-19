export type DesignerGallerySort = 'newest' | 'name' | 'recent';

export const templateCategoryKey = (category?: string | null, mode?: string | null): string => {
  const normalized = (category || '').trim().toLowerCase();
  if (['ig-post', 'instagram-post', 'instagram post', 'ig post'].includes(normalized)) {
    return 'ig-post';
  }
  if (['custom', 'custom-video', 'custom video'].includes(normalized)) return 'custom';
  if (normalized === 'video') return 'video';
  if (normalized) return normalized;
  return mode === 'video' ? 'video' : 'other';
};

export const templateCategoryLabel = (category?: string | null, mode?: string | null): string => {
  const normalized = (category || '').trim();
  switch (templateCategoryKey(normalized, mode)) {
    case 'video': return 'Video';
    case 'custom': return 'Custom';
    case 'ig-post': return 'IG Post';
    case 'other': return 'Other';
    default: return normalized;
  }
};

export const templateCategorySearchAliases = (query: string): string[] => {
  const trimmed = query.trim();
  return templateCategoryKey(trimmed) === 'ig-post'
    ? [trimmed, 'ig-post', 'instagram-post', 'instagram post', 'ig post']
    : [trimmed];
};
