'use client';

import dynamic from 'next/dynamic';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// ---- sessionStorage handoff parsing (validated, one-shot) -------------------
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asNum = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const asAssetType = (v: unknown): 'photo' | 'video' | undefined =>
  v === 'photo' || v === 'video' ? v : undefined;

interface BulkAsset {
  url: string;
  type?: 'photo' | 'video';
  thumbUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  source?: string;
}
interface CaptionHandoff {
  url: string;
  fileId?: string;
  width?: number;
  height?: number;
  words: { word: string; start: number; end: number }[];
}
interface TimelineHandoff {
  type: 'video' | 'audio';
  url: string;
  fileId?: string;
  width?: number;
  height?: number;
}

function readHandoff(key: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function parseBulkAssets(raw: unknown): BulkAsset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw
    .filter((a): a is Record<string, unknown> => isObj(a) && typeof a.url === 'string')
    .map((a): BulkAsset => ({
      url: a.url as string,
      type: asAssetType(a.type),
      thumbUrl: asStr(a.thumbUrl),
      naturalWidth: asNum(a.naturalWidth),
      naturalHeight: asNum(a.naturalHeight),
      source: asStr(a.source),
    }));
  return valid.length ? valid : undefined;
}

function parseCaptionHandoff(raw: unknown): CaptionHandoff | undefined {
  if (!isObj(raw) || typeof raw.url !== 'string' || !Array.isArray(raw.words)) return undefined;
  const words = raw.words
    .filter(
      (w): w is Record<string, unknown> =>
        isObj(w) &&
        typeof w.word === 'string' &&
        typeof w.start === 'number' &&
        typeof w.end === 'number'
    )
    .map((w) => ({ word: w.word as string, start: w.start as number, end: w.end as number }));
  if (!words.length) return undefined;
  return {
    url: raw.url,
    fileId: asStr(raw.fileId),
    width: asNum(raw.width),
    height: asNum(raw.height),
    words,
  };
}

function parseTimelineHandoff(raw: unknown): TimelineHandoff | undefined {
  if (!isObj(raw) || typeof raw.url !== 'string') return undefined;
  if (raw.type !== 'video' && raw.type !== 'audio') return undefined;
  return {
    type: raw.type,
    url: raw.url,
    fileId: asStr(raw.fileId),
    width: asNum(raw.width),
    height: asNum(raw.height),
  };
}

const DesignerPage = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/designer/designer').then(
      (m) => m.Designer
    ),
  { ssr: false }
);

// "Open in Designer" (stock photos/videos) navigates here with the asset in the
// query string — no modal. When `url` is present we build the same initialAsset
// the picker used to pass; otherwise the Designer shows its preset picker.
function DesignerWithParams() {
  const sp = useSearchParams();
  const url = sp.get('url') || undefined;
  const designId = sp.get('designId') || undefined;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);

  const initialAsset = url
    ? {
        url,
        type: (sp.get('type') as 'photo' | 'video') || 'photo',
        thumbUrl: sp.get('thumbUrl') || undefined,
        author: sp.get('author') || undefined,
        authorUrl: sp.get('authorUrl') || undefined,
        downloadLocation: sp.get('downloadLocation') || undefined,
        source: sp.get('source') || undefined,
        width: num('w'),
        height: num('h'),
        naturalWidth: num('nw'),
        naturalHeight: num('nh'),
      }
    : undefined;

  // Parse + clear the sessionStorage handoffs ONCE (lazy state initializer), not
  // during every render, and validate each shape before trusting it. "Open all in
  // Designer" (?bulk=1), the Deepgram caption handoff (?captions=1), and the
  // timeline handoff (?timeline=1) each stash JSON too large/complex for the query
  // string; the keys are removed so a refresh doesn't re-apply them.
  const [handoffs] = useState(() => {
    const bulk = sp.get('bulk') ? parseBulkAssets(readHandoff('designer:bulk-assets')) : undefined;
    const captions = sp.get('captions')
      ? parseCaptionHandoff(readHandoff('designer:caption-handoff'))
      : undefined;
    const timeline = sp.get('timeline')
      ? parseTimelineHandoff(readHandoff('designer:timeline-handoff'))
      : undefined;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('designer:timeline-handoff');
      window.sessionStorage.removeItem('designer:caption-handoff');
      window.sessionStorage.removeItem('designer:bulk-assets');
    }
    return { initialAssets: bulk, initialCaptionVideo: captions, initialTimelineMedia: timeline };
  });
  const { initialAssets, initialCaptionVideo, initialTimelineMedia } = handoffs;

  // The Designer initialises its store once from initialAsset, so remount it
  // when the asset changes (navigating straight from one asset to another).
  return (
    <DesignerPage
      key={
        designId ||
        url ||
        (initialTimelineMedia
          ? `timeline-${initialTimelineMedia.type}`
          : initialCaptionVideo
          ? 'captions'
          : initialAssets
          ? 'bulk'
          : 'blank')
      }
      designId={designId}
      initialAsset={initialAsset}
      initialAssets={initialAssets}
      initialCaptionVideo={initialCaptionVideo}
      initialTimelineMedia={initialTimelineMedia}
    />
  );
}

export default function DesignerRoute() {
  return (
    <div className="h-full flex flex-col">
      <Suspense fallback={null}>
        <DesignerWithParams />
      </Suspense>
    </div>
  );
}
