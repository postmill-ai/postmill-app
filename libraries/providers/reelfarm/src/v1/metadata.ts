import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "reelfarm",
  "displayName": "reelfarm",
  "kind": "action",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-to-video",
    "text-to-video"
  ],
  "hasModelList": false,
  "website": "https://reel.farm",
  "description": {
    "en": "Reel.Farm turns a single prompt into an ordered TikTok-style slideshow — slide text, layout, and pacing are all generated for you. Postmill converts the returned slides into a silent MP4 locally. Aspect ratio, image fit, and seconds per slide apply only to that local conversion; they are not sent to Reel.Farm. Note: Reel.Farm’s public API creates slideshow videos only; UGC/avatar and greenscreen videos are generated in the Reel.Farm app (the API can list them, but not create them)."
  }
};
