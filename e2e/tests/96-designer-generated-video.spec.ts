import { test, expect, type Page, type Route } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildFramePage } from '../../libraries/nestjs-libraries/src/media/design-render/frame-page';
import { escapeForScriptTag, FRAME_RENDERER_SCRIPT } from '../../libraries/nestjs-libraries/src/media/design-render/frame-renderer-script';

const DESIGN_ID = 'design-generated-video-e2e';
const GENERATED_URL = '/mock-storage/generated.mp4';
const REPLACEMENT_URL = '/mock-storage/replacement.webm';
const ASYMMETRIC_URL = '/mock-storage/asymmetric-8x2.png';
const REPLACEMENT_IMAGE_URL = '/mock-storage/replacement-image.png';
const TRANSPARENT_IMAGE_URL = '/mock-storage/transparent.png';
const CUTOUT_SOURCE_URL = '/mock-storage/cutout-source.png';
const CUTOUT_RESULT_URL = '/mock-storage/cutout-result.png';
const CUTOUT_VERTICAL_SOURCE_URL = '/mock-storage/cutout-vertical-source.png';
const CUTOUT_VERTICAL_RESULT_URL = '/mock-storage/cutout-vertical-result.png';
const CUSTOM_POSTER_URL = '/mock-storage/custom-poster.png';
const STOCK_VECTOR_URL = '/mock-storage/outline-vector.svg';
const STOCK_ICON_URL = '/mock-storage/outline-icon.svg';
const STOCK_STICKER_URL = '/mock-storage/animated-sticker.mp4';
const STOCK_VECTOR_THUMB_URL = '/mock-storage/vector-thumb.png';
const IMPORTED_VECTOR_URL = '/mock-storage/imported-vector.png';
const GENERATED_POSTER_URL = 'https://app.postmill.ai/mock-storage/generated-poster.jpg';
const RENDERED_VIDEO_URL = '/mock-storage/designer-render.mp4';
const GENERATE_PATH = '/media/generate-video';

interface CropSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VideoClipSnapshot {
  id: string;
  src?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  startMs: number;
  endMs: number;
  text?: string;
  fileId?: string;
  originId?: string;
  groupId?: string;
  mediaType?: 'video' | 'image';
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontFamily?: string;
  borderRadius?: number | [number, number, number, number];
  filters?: string[];
  smartFilters?: unknown[];
  originalSrc?: string;
  originalFileId?: string;
  maskSrc?: string;
  maskFileId?: string;
  maskEnabled?: boolean;
  keyframes?: unknown[];
  shape?: string;
  fill?: string;
  crop?: CropSnapshot;
  fitMode?: 'contain' | 'cover' | 'fill';
  blendMode?: string;
  focalPoint?: { x: number; y: number };
  align?: 'left' | 'center' | 'right' | 'justify';
  fillGradient?: {
    type: 'linear' | 'radial';
    stops: Array<{ offset: number; color: string }>;
  };
  textStroke?: { color: string; width: number };
  transitionIn?: { type: string; durationMs: number };
  transitionOut?: { type: string; durationMs: number };
}

interface DesignerElementSnapshot extends Omit<VideoClipSnapshot, 'startMs' | 'endMs'> {
  type?: string;
  parentId?: string;
  richText?: Array<{
    text: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: string;
    fill?: string;
  }>;
}

interface DesignerDocSnapshot {
  version: number;
  mode: string;
  outputs: Array<{
    id?: string;
    formatId?: string;
    name?: string;
    width: number;
    height: number;
    durationMs?: number;
    background?: string;
    bg?: {
      type: string;
      src?: string;
      naturalWidth?: number;
      naturalHeight?: number;
      focalPoint?: { x: number; y: number };
    };
    tracks: Array<{ id: string; type: string; clips: VideoClipSnapshot[] }>;
    children?: DesignerElementSnapshot[];
  }>;
}

const blankDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'video',
  outputs: [
    {
      width: 1080,
      height: 1920,
      durationMs: 10_000,
      tracks: [],
    },
  ],
});

const staticCropDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'image',
  outputs: [{
    id: 'static-output',
    formatId: 'static-crop',
    name: 'Static crop',
    width: 400,
    height: 300,
    background: '#000000',
    tracks: [],
    bg: {
      type: 'image',
      src: ASYMMETRIC_URL,
      naturalWidth: 8,
      naturalHeight: 2,
      focalPoint: { x: 0.75, y: 0.5 },
    },
    children: [{
      id: 'static-image',
      type: 'image',
      src: ASYMMETRIC_URL,
      x: 100,
      y: 50,
      width: 200,
      height: 100,
      naturalWidth: 8,
      naturalHeight: 2,
      fitMode: 'cover',
      focalPoint: { x: 0.75, y: 0.5 },
    }],
  }],
});

const richTextDoc = (): DesignerDocSnapshot => ({
  version: 13,
  mode: 'image',
  outputs: [{
    id: 'rich-text-output',
    formatId: 'rich-text',
    name: 'Rich text',
    width: 400,
    height: 300,
    background: '#ffffff',
    tracks: [],
    children: [{
      id: 'rich-text-element',
      type: 'text',
      text: 'Original headline',
      x: 40,
      y: 40,
      width: 300,
      height: 60,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fontFamily: 'Inter',
      fontSize: 32,
      fontWeight: 400,
      fill: '#000000',
    }],
  }],
});

const videoCropDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'video',
  outputs: [{
    width: 400,
    height: 300,
    durationMs: 4000,
    tracks: [{
      id: 'video-crop-track',
      type: 'video',
      clips: [{
        id: 'video-crop-clip',
        src: GENERATED_URL,
        startMs: 0,
        endMs: 4000,
        x: 50,
        y: 40,
        width: 200,
        height: 100,
        naturalWidth: 720,
        naturalHeight: 1280,
        fitMode: 'cover',
        focalPoint: { x: 0.5, y: 0.75 },
      }],
    }],
  }],
});

const apiPath = (rawUrl: string): string => {
  const pathname = new URL(rawUrl).pathname;
  return pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

class DesignerMocks {
  readonly generatePosts: string[] = [];
  readonly backgroundRemovalPosts: string[] = [];
  readonly maskUploads = new Map<string, Buffer>();
  readonly assistantCopyPosts: string[] = [];
  readonly assistantSuggestionPosts: string[] = [];
  readonly unexpectedProviderPosts: string[] = [];
  readonly httpErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly renderRequests: Array<Record<string, unknown>> = [];
  readonly fileInformationUpdates: Array<Record<string, unknown>> = [];
  readonly fontUploads: string[] = [];
  readonly customFonts: Array<Record<string, unknown>> = [];
  dashboardJobReads = 0;
  studioStatusReads = 0;
  designWrites = 0;
  doc = blankDoc();
  name = 'Generated video E2E';
  brand: {
    id: string;
    name: string;
    palette: string[];
    fontFamilies: string[];
    logoFileIds: string[];
    isDefault: boolean;
  } | null = null;
  jobOutcome: 'completed' | 'failed' = 'completed';
  renderFile = {
    id: 'file-rendered-e2e',
    name: 'designer-render.mp4',
    originalName: 'designer-render.mp4',
    path: RENDERED_VIDEO_URL,
    thumbnail: GENERATED_POSTER_URL,
    alt: '',
    thumbnailTimestamp: 0,
    fileSize: 1000,
    type: 'video',
    tags: null,
    description: null,
    folderId: null,
    createdAt: new Date(0).toISOString(),
    metadata: { generatedPosterUrl: GENERATED_POSTER_URL } as Record<string, unknown>,
  };

  private readonly fixtures = {
    [GENERATED_URL]: {
      file: 'motion-rear-moov.mp4',
      contentType: 'video/mp4',
    },
    [REPLACEMENT_URL]: {
      file: 'replacement.webm',
      contentType: 'video/webm',
    },
    [STOCK_STICKER_URL]: {
      file: 'motion.mp4',
      contentType: 'video/mp4',
    },
    [RENDERED_VIDEO_URL]: {
      file: 'motion-rear-moov.mp4',
      contentType: 'video/mp4',
    },
    [ASYMMETRIC_URL]: {
      file: 'asymmetric-8x2.png',
      contentType: 'image/png',
    },
    [REPLACEMENT_IMAGE_URL]: {
      file: 'asymmetric-8x2.png',
      contentType: 'image/png',
    },
    [TRANSPARENT_IMAGE_URL]: {
      file: 'transparent-2x2.png',
      contentType: 'image/png',
    },
    [CUTOUT_SOURCE_URL]: {
      file: 'cutout-source-8x2.png',
      contentType: 'image/png',
    },
    [CUTOUT_RESULT_URL]: {
      file: 'cutout-result-8x2.png',
      contentType: 'image/png',
    },
    [CUTOUT_VERTICAL_SOURCE_URL]: {
      file: 'cutout-vertical-source-8x2.png',
      contentType: 'image/png',
    },
    [CUTOUT_VERTICAL_RESULT_URL]: {
      file: 'cutout-vertical-result-8x2.png',
      contentType: 'image/png',
    },
    [CUSTOM_POSTER_URL]: {
      file: 'asymmetric-8x2.png',
      contentType: 'image/png',
    },
    [GENERATED_POSTER_URL]: {
      file: 'asymmetric-8x2.png',
      contentType: 'image/png',
    },
    [STOCK_VECTOR_URL]: {
      file: 'outline-vector.svg',
      contentType: 'image/svg+xml',
    },
    [STOCK_ICON_URL]: {
      file: 'outline-vector.svg',
      contentType: 'image/svg+xml',
    },
    [STOCK_VECTOR_THUMB_URL]: {
      file: 'asymmetric-8x2.png',
      contentType: 'image/png',
    },
    [IMPORTED_VECTOR_URL]: {
      file: 'asymmetric-8x2.png',
      contentType: 'image/png',
    },
    '/mock-fonts/WendyOne-Regular.ttf': {
      file: 'WendyOne-Regular.ttf',
      contentType: 'font/ttf',
    },
    '/mock-fonts/PlaywriteGBJ-VariableFont_wght.ttf': {
      file: 'PlaywriteGBJ-VariableFont_wght.ttf',
      contentType: 'font/ttf',
    },
  };

  async install(page: Page) {
    page.on('response', (response) => {
      if (response.status() >= 400 && !/gravatar\.com|ingest\.us\.sentry\.io|\.(?:otf|ttf|woff2?)(?:$|\?)/.test(response.url())) {
        this.httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    page.on('pageerror', (error) => this.pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/Download the React DevTools|\[Fast Refresh\]|ResizeObserver loop|Sentry Logger|Loading the font|Failed to load resource: the server responded with a status of 404/i.test(text)) return;
      this.consoleErrors.push(text);
    });

    await page.route('**/*', async (route) => {
      const request = route.request();
      const method = request.method();
      const pathname = apiPath(request.url());
      const hostname = new URL(request.url()).hostname;
      if (hostname === 'www.gravatar.com') {
        await route.fulfill({ status: 204 });
        return;
      }
      if (hostname.endsWith('.ingest.us.sentry.io')) {
        await json(route, {});
        return;
      }
      if (method === 'GET' && pathname === '/user/self') {
        await json(route, {
          id: 'e2e-user',
          email: 'qa@example.test',
          orgId: 'e2e-org',
          role: 'owner',
          isSuperAdmin: true,
          activated: true,
          setupCompleted: true,
          profile: {},
        });
        return;
      }
      if (method === 'POST' && pathname === '/user/preferred-language') {
        await json(route, {});
        return;
      }
      if (method === 'GET' && pathname === '/settings/roles/me') {
        await json(route, { role: 'owner', permissions: [], isSuperAdmin: true });
        return;
      }
      if (method === 'GET' && pathname === '/user/organizations') {
        await json(route, [{ id: 'e2e-org', name: 'E2E Org', users: [{ disabled: false }] }]);
        return;
      }
      if (method === 'GET' && pathname === '/brands') {
        await json(route, this.brand ? [this.brand] : []);
        return;
      }
      if (method === 'GET' && ['/announcements', '/notifications', '/integrations/list'].includes(pathname)) {
        await json(route, []);
        return;
      }
      if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/settings/storage', '/files/limits'].includes(pathname)) {
        await json(route, {});
        return;
      }

      if (method === 'GET' && pathname.startsWith('/mock-masks/')) {
        const body = this.maskUploads.get(pathname);
        if (body) {
          await route.fulfill({ status: 200, contentType: 'image/png', body });
          return;
        }
      }

      const optimizerSource = pathname === '/_next/image'
        ? new URL(request.url()).searchParams.get('url')
        : null;
      const fixturePath = new URL(optimizerSource || pathname, 'https://app.postmill.ai').pathname;
      const fixture = Object.entries(this.fixtures).find(([source]) =>
        new URL(source, 'https://app.postmill.ai').pathname === fixturePath
      )?.[1];
      if (fixture && method === 'GET') {
        await fulfillVideo(route, fixture.file, fixture.contentType);
        return;
      }

      if (pathname === '/media/tools/status' && method === 'GET') {
        await json(route, {
          operations: {
            tts: { available: true },
            stt: { available: true },
            'bg-remove': { available: true },
          },
          tools: Object.fromEntries(
            [
              'text-to-video',
              'image-to-video',
              'video-upscale',
              'video-background',
              'video-to-video',
              'text-to-music',
              'video-avatar',
              'image-slide',
            ].map((tool) => [tool, { available: true }])
          ),
        });
        return;
      }

      if (pathname === '/dashboard/media-jobs' && method === 'GET') {
        this.dashboardJobReads++;
        await json(route, { jobs: [] });
        return;
      }

      if (pathname === '/media/generation-providers' && method === 'GET') {
        await json(route, {
          providers: [{ identifier: 'replicate', name: 'Replicate' }],
          default: { providerId: 'mock-provider', model: 'mock-video' },
        });
        return;
      }

      if (['/media/studio/replicate/status', '/media/replicate/status'].includes(pathname) && method === 'GET') {
        this.studioStatusReads++;
        await json(route, { configured: true, enabled: true });
        return;
      }

      if (pathname === '/media/replicate/categories' && method === 'GET') {
        await json(route, [
          { key: 'text-to-video', medium: 'video', label: 'Text to Video', execution: 'async' },
          { key: 'image-to-video', medium: 'video', label: 'Image to Video', execution: 'async' },
        ]);
        return;
      }

      if (/^\/media\/replicate\/categories\/(text|image)-to-video\/models$/.test(pathname) && method === 'GET') {
        await json(route, []);
        return;
      }

      if (pathname === '/media/studio/replicate/jobs' && method === 'GET') {
        await json(route, []);
        return;
      }

      if (pathname === '/files/folders' && method === 'GET') {
        await json(route, []);
        return;
      }

      if (pathname === '/files' && method === 'GET' && request.resourceType() !== 'document') {
        await json(route, {
          results: [
            this.renderFile,
            {
              id: 'replacement-image-file',
              name: 'replacement-image.png',
              originalName: 'replacement-image.png',
              path: REPLACEMENT_IMAGE_URL,
              thumbnail: REPLACEMENT_IMAGE_URL,
              alt: null,
              thumbnailTimestamp: null,
              fileSize: 1234,
              type: 'image',
              tags: null,
              description: null,
              folderId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              metadata: { dimensions: { width: 8, height: 2 }, mimeType: 'image/png' },
            },
          ],
          total: 2,
        });
        return;
      }

      if (pathname === '/media/designer-assistant/copy' && method === 'POST') {
        this.assistantCopyPosts.push(request.postData() || '');
        await json(route, { variants: ['AI holiday headline', 'Second option', 'Third option'] });
        return;
      }

      if (pathname === '/media/designer-assistant/suggestions' && method === 'POST') {
        this.assistantSuggestionPosts.push(request.postData() || '');
        await json(route, {
          suggestions: [{
            category: 'font',
            title: 'Use a serif headline',
            rationale: 'Improve seasonal contrast',
            style: { fontFamily: 'Georgia', fill: '#123456' },
          }],
        });
        return;
      }

      if (pathname === '/media/remove-background' && method === 'POST') {
        const body = request.postDataJSON() as { imageUrl?: string };
        this.backgroundRemovalPosts.push(request.postData() || '');
        await new Promise((resolve) => setTimeout(resolve, 250));
        await json(route, {
          url: body.imageUrl === CUTOUT_VERTICAL_SOURCE_URL
            ? CUTOUT_VERTICAL_RESULT_URL
            : [CUTOUT_SOURCE_URL, ASYMMETRIC_URL, REPLACEMENT_IMAGE_URL].includes(body.imageUrl || '')
              ? CUTOUT_RESULT_URL
              : TRANSPARENT_IMAGE_URL,
        });
        return;
      }

      if (pathname === GENERATE_PATH && method === 'POST') {
        this.generatePosts.push(request.postData() || '');
        await json(route, { id: this.jobOutcome === 'completed' ? 'job-complete' : 'job-failed' });
        return;
      }

      if (pathname === '/media/jobs/job-complete' && method === 'GET') {
        await json(route, {
          status: 'completed',
          artifactUrl: GENERATED_URL,
          fileId: 'file-generated-e2e',
          fileType: 'video',
          metadata: {
            dimensions: { width: 720, height: 1280 },
            durationMs: 4000,
          },
        });
        return;
      }

      if (pathname === '/media/jobs/job-failed' && method === 'GET') {
        await json(route, { status: 'failed', error: 'Mock generation failed' });
        return;
      }

      if (pathname === '/media/detect-focal-point' && method === 'POST') {
        await json(route, { x: 0.5, y: 0.5 });
        return;
      }

      if (pathname === '/media/upscale-video' && method === 'POST') {
        await json(route, { id: REPLACEMENT_URL });
        return;
      }

      if (pathname === '/media/stock/stickers' && method === 'GET') {
        await json(route, {
          results: [{
            id: 'animated-sticker-1',
            url: ASYMMETRIC_URL,
            thumbUrl: ASYMMETRIC_URL,
            mp4Url: STOCK_STICKER_URL,
            isSticker: true,
            description: 'QA animated sticker',
            author: 'QA Stickers',
            authorUrl: 'https://example.com/stickers',
            sourceUrl: 'https://example.com/sticker',
            width: 720,
            height: 1280,
            source: 'giphy',
            attribution: { provider: 'GIPHY' },
          }],
          page: 1,
          totalPages: 1,
          configured: true,
          source: 'giphy',
        });
        return;
      }

      if (pathname === '/media/stock/icons' && method === 'GET') {
        await json(route, {
          results: [{
            id: 'mdi:square',
            url: STOCK_ICON_URL,
            thumbUrl: STOCK_ICON_URL,
            description: 'QA outline icon',
            author: 'QA Icons',
            authorUrl: 'https://example.com/icons',
            sourceUrl: 'https://example.com/icon',
            width: 24,
            height: 24,
            source: 'iconify',
            prefix: 'mdi',
            iconName: 'square',
            license: 'MIT',
            attribution: { provider: 'Iconify', license: 'MIT' },
          }],
          page: 1,
          totalPages: 1,
          configured: true,
          source: 'iconify',
        });
        return;
      }

      if (pathname === '/media/icons/resolve' && method === 'GET') {
        await json(route, { body: '<rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="4"/>' });
        return;
      }

      if (pathname === '/media/stock/vectors' && method === 'GET') {
        await json(route, {
          results: [{
            id: 'vector-1',
            url: STOCK_VECTOR_URL,
            thumbUrl: STOCK_VECTOR_THUMB_URL,
            description: 'QA outline vector',
            author: 'QA Artist',
            authorUrl: 'https://example.com/qa-artist',
            sourceUrl: 'https://example.com/vector',
            width: 24,
            height: 24,
            source: 'pixabay',
            attribution: { provider: 'Pixabay', userId: 42 },
          }],
          page: 1,
          totalPages: 1,
          configured: true,
          source: 'pixabay',
        });
        return;
      }

      if (pathname === '/media/fonts' && method === 'GET') {
        await json(route, this.customFonts);
        return;
      }

      if (pathname === '/media/fonts/upload' && method === 'POST') {
        const multipart = request.postDataBuffer()?.toString('latin1') || '';
        const fileName = /filename="([^"]+)"/.exec(multipart)?.[1] || 'unknown.ttf';
        this.fontUploads.push(fileName);
        const family = fileName.startsWith('WendyOne') ? 'Wendy One' : 'Playwrite GB J';
        const entry = {
          family,
          fileId: `font-${this.customFonts.length + 1}`,
          path: `/mock-fonts/${fileName}`,
          weights: [400],
          serverRender: true,
        };
        this.customFonts.push(entry);
        await json(route, { uploaded: entry });
        return;
      }

      if (pathname === '/media/designs/render-video' && method === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        this.renderRequests.push(body);
        this.renderFile.thumbnail = typeof body.posterUrl === 'string'
          ? body.posterUrl
          : GENERATED_POSTER_URL;
        this.renderFile.thumbnailTimestamp = typeof body.posterTimeMs === 'number'
          ? body.posterTimeMs
          : 0;
        await json(route, { id: 'designer-render-job', status: 'pending' });
        return;
      }

      if (pathname === '/media/designs/render-video/designer-render-job' && method === 'GET') {
        await json(route, {
          id: 'designer-render-job',
          status: 'completed',
          progress: 100,
          artifactUrl: RENDERED_VIDEO_URL,
          fileId: this.renderFile.id,
          alt: this.renderFile.alt,
          thumbnailUrl: this.renderFile.thumbnail,
          generatedPosterUrl: this.renderFile.metadata.generatedPosterUrl,
          thumbnailTimestamp: this.renderFile.thumbnailTimestamp,
        });
        return;
      }

      if (pathname === '/files/information' && method === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        this.fileInformationUpdates.push(body);
        this.renderFile.thumbnail = String(body.thumbnail);
        this.renderFile.thumbnailTimestamp = Number(body.thumbnailTimestamp || 0);
        this.renderFile.alt = String(body.alt || '');
        await json(route, this.renderFile);
        return;
      }

      if (pathname === '/files' && method === 'GET' && request.resourceType() !== 'document') {
        await json(route, { results: [this.renderFile], total: 1 });
        return;
      }

      if (pathname === '/files/folders' && method === 'GET') {
        await json(route, []);
        return;
      }

      if (pathname === '/files/upload-simple' && method === 'POST') {
        const multipart = request.postDataBuffer()?.toString('latin1') || '';
        if (multipart.includes('QA outline vector.png')) {
          await json(route, { id: 'vector-file-1', path: IMPORTED_VECTOR_URL });
          return;
        }
        if (multipart.includes(':mask')) {
          const raw = request.postDataBuffer()!;
          const start = raw.indexOf(Buffer.from('\r\n\r\n')) + 4;
          const end = raw.lastIndexOf(Buffer.from('\r\n--'));
          const fileId = `mask-file-${this.maskUploads.size + 1}`;
          const path = `/mock-masks/${fileId}.png`;
          this.maskUploads.set(path, raw.subarray(start, end));
          await json(route, { id: fileId, path });
          return;
        }
        const customPoster = multipart.includes('asymmetric-8x2.png');
        await json(route, customPoster
          ? { id: 'custom-poster-e2e', path: CUSTOM_POSTER_URL }
          : { id: 'static-export-png', path: '/mock-storage/static-export.png' });
        return;
      }

      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'GET') {
        await json(route, { id: DESIGN_ID, name: this.name, doc: this.doc });
        return;
      }

      if (pathname === `/media/designs/${DESIGN_ID}` && method === 'PUT') {
        const body = request.postDataJSON() as { name: string; doc: DesignerDocSnapshot };
        this.name = body.name;
        this.doc = body.doc;
        this.designWrites++;
        await json(route, { id: DESIGN_ID, name: this.name, doc: this.doc });
        return;
      }

      if (method === 'POST' && /^\/media\/(studio\/[^/]+\/generate|generate-)/.test(pathname)) {
        this.unexpectedProviderPosts.push(`${method} ${pathname}`);
        await json(route, { message: 'Unexpected provider call blocked by E2E' }, 503);
        return;
      }

      const frontendOrigin = process.env.E2E_FRONTEND_ORIGIN;
      const requestUrl = new URL(request.url());
      if (
        frontendOrigin &&
        requestUrl.origin === 'https://app.postmill.ai' &&
        !pathname.startsWith('/api/')
      ) {
        const frontend = new URL(frontendOrigin);
        if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(frontend.hostname)) {
          throw new Error('E2E_FRONTEND_ORIGIN must be a loopback HTTP origin');
        }
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers['content-length'];
        const response = await fetch(`${frontendOrigin}${pathname}${requestUrl.search}`, {
          method,
          headers,
          body: request.postDataBuffer() ?? undefined,
        });
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
            responseHeaders[key] = value;
          }
        });
        await route.fulfill({
          status: response.status,
          headers: responseHeaders,
          body: Buffer.from(await response.arrayBuffer()),
        });
        return;
      }

      const backendOrigin = process.env.E2E_BACKEND_ORIGIN;
      const backend = backendOrigin ? new URL(backendOrigin) : null;
      if (backend && (requestUrl.origin === 'https://api.postmill.ai' || requestUrl.origin === backend.origin)) {
        if (backend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(backend.hostname)) {
          throw new Error('E2E_BACKEND_ORIGIN must be a loopback HTTP origin');
        }
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers['content-length'];
        const localCookies = await page.context().cookies(page.url());
        headers.cookie = localCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        const response = await fetch(`${backendOrigin}${pathname}${new URL(request.url()).search}`, {
          method,
          headers,
          body: request.postDataBuffer() ?? undefined,
        });
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
            responseHeaders[key] = value;
          }
        });
        if (headers.origin) responseHeaders['access-control-allow-origin'] = headers.origin;
        responseHeaders['access-control-allow-credentials'] = 'true';
        await route.fulfill({
          status: response.status,
          headers: responseHeaders,
          body: Buffer.from(await response.arrayBuffer()),
        });
        return;
      }

      await route.continue();
    });
  }

  savedClips(): VideoClipSnapshot[] {
    return this.doc.outputs[0].tracks?.flatMap((track) => track.clips) ?? [];
  }

  expectClean() {
    expect(this.unexpectedProviderPosts, 'no unmocked provider generation POSTs').toEqual([]);
    expect(this.httpErrors, 'no HTTP route errors').toEqual([]);
    expect(this.consoleErrors, 'no browser console errors').toEqual([]);
    expect(this.pageErrors, 'no uncaught browser errors').toEqual([]);
  }
}

async function fulfillVideo(route: Route, fixtureFile: string, contentType: string) {
  const fixtureDir = fixtureFile.endsWith('.ttf')
    ? path.join(__dirname, '../../apps/frontend/public/fonts')
    : path.join(__dirname, '../fixtures');
  const body = fs.readFileSync(path.join(fixtureDir, fixtureFile));
  const range = route.request().headers()['range'];
  const common = {
    'accept-ranges': 'bytes',
    'content-type': contentType,
    'cache-control': 'no-store',
  };
  if (!range) {
    await route.fulfill({ status: 200, headers: common, body });
    return;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    await route.fulfill({ status: 416, headers: { 'content-range': `bytes */${body.length}` } });
    return;
  }
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
  if (start >= body.length || end < start) {
    await route.fulfill({ status: 416, headers: { 'content-range': `bytes */${body.length}` } });
    return;
  }
  await route.fulfill({
    status: 206,
    headers: { ...common, 'content-range': `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1),
  });
}

async function openDesigner(page: Page, mocks: DesignerMocks) {
  await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'AI Video', exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(0);
}

async function openGenerationDialog(page: Page) {
  await page.getByRole('button', { name: 'AI Video', exact: true }).click();
  await expect(page.getByPlaceholder('Describe the video you want to generate...')).toBeVisible();
}

async function generateFromDefaultProvider(page: Page, prompt: string) {
  await openGenerationDialog(page);
  await page.getByPlaceholder('Describe the video you want to generate...').fill(prompt);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
}

async function saveDesign(page: Page) {
  await page.getByRole('button', { name: 'Save (Ctrl+S)' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

async function canvasFingerprint(page: Page): Promise<string> {
  return page.locator('.konvajs-content canvas').evaluateAll((canvases) => {
    let hash = 2166136261;
    let samples = 0;
    for (const canvas of canvases) {
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) continue;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const stride = Math.max(4, Math.floor(pixels.length / 12000 / 4) * 4);
      for (let index = 0; index < pixels.length; index += stride) {
        hash ^= pixels[index] + pixels[index + 1] * 3 + pixels[index + 2] * 7 + pixels[index + 3] * 11;
        hash = Math.imul(hash, 16777619);
        samples++;
      }
    }
    return `${samples}:${hash >>> 0}`;
  });
}

async function canvasCenterRgb(page: Page): Promise<number> {
  return page.locator('.konvajs-content canvas').first().evaluate((canvas) => {
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) return 0;
    const pixel = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    ).data;
    return pixel[0] + pixel[1] + pixel[2];
  });
}

async function expectRealPlayback(page: Page) {
  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => canvasCenterRgb(page), 'the decoded frame must be visible, not a black artboard').toBeGreaterThan(0);
  const beforeTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  const beforePixels = await canvasFingerprint(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(beforeTime + 0.25);
  await expect.poll(() => canvasCenterRgb(page), 'playback must keep painting real frames').toBeGreaterThan(0);
  await expect.poll(() => canvasFingerprint(page)).not.toBe(beforePixels);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}

test.describe('Designer generated video (fully mocked provider and storage)', () => {
  test('explicit generation lands, scales, plays, saves/reopens, and replaces the same clip source', async ({ page }) => {
    const mocks = new DesignerMocks();
    await mocks.install(page);
    await openDesigner(page, mocks);
    expect(mocks.generatePosts, 'mount must not generate').toHaveLength(0);

    await openGenerationDialog(page);
    await page.getByLabel('Provider:').selectOption('replicate');
    await page.getByLabel('Category').selectOption({ label: 'Text to Video' });
    await page.getByLabel('Provider:').selectOption('');
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
    expect(mocks.generatePosts, 'provider/category switch must not generate').toHaveLength(0);
    await page.getByPlaceholder('Describe the video you want to generate...').fill('A deterministic moving fixture');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(1);
    await expect.poll(() => mocks.savedClips().length, 'autosave persists the generated clip').toBe(1);
    expect(mocks.generatePosts, 'exactly one explicit Generate POST').toHaveLength(1);
    expect(JSON.parse(mocks.generatePosts[0]).prompt).toBe('A deterministic moving fixture');

    const inserted = mocks.savedClips()[0];
    expect(inserted).toMatchObject({
      src: GENERATED_URL,
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      naturalWidth: 720,
      naturalHeight: 1280,
      startMs: 0,
      endMs: 4000,
    });
    expect(inserted.width! / inserted.height!).toBeCloseTo(720 / 1280, 8);
    await expectRealPlayback(page);

    await saveDesign(page);
    const savedId = mocks.savedClips()[0].id;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(1);
    await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(1);
    expect(mocks.generatePosts, 'reload must not generate again').toHaveLength(1);
    await expectRealPlayback(page);

    await page.getByRole('slider', { name: 'Seek timeline', exact: true }).press('Home');
    await expect(page.getByRole('slider', { name: 'Seek timeline', exact: true })).toHaveAttribute('aria-valuenow', '0');
    const beforeReplacementPixels = await canvasFingerprint(page);
    await page.getByRole('slider', { name: 'Clip', exact: true }).click({ button: 'right' });
    await page.getByRole('button', { name: 'Upscale', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Upscale video', exact: true }).press('Enter');
    await expect(page.locator('video')).toHaveAttribute('src', REPLACEMENT_URL);
    await expect.poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => canvasFingerprint(page)).not.toBe(beforeReplacementPixels);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);

    await saveDesign(page);
    await expect.poll(() => mocks.savedClips()[0]?.src).toBe(REPLACEMENT_URL);
    expect(mocks.savedClips()).toHaveLength(1);
    expect(mocks.savedClips()[0].id, 'source replacement preserves clip id').toBe(savedId);
    expect(mocks.generatePosts, 'transform must not re-run text-to-video generation').toHaveLength(1);
    mocks.expectClean();
  });

  test('a terminal failed job creates no clip and no duplicate generation POST', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.jobOutcome = 'failed';
    await mocks.install(page);
    await openDesigner(page, mocks);

    await generateFromDefaultProvider(page, 'This job is mocked to fail');
    await expect(page.getByText('Mock generation failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
    expect(mocks.savedClips()).toHaveLength(0);
    expect(mocks.generatePosts).toHaveLength(1);

    await openGenerationDialog(page);
    await page.getByLabel('Provider:').selectOption('replicate');
    await page.getByLabel('Category').selectOption({ label: 'Text to Video' });
    expect(mocks.generatePosts, 'reopening or switching provider must not retry').toHaveLength(1);
    expect(mocks.savedClips()).toHaveLength(0);
    mocks.expectClean();
  });
});


const essentialsDoc = (): DesignerDocSnapshot => ({
  version: 10,
  mode: 'video',
  outputs: [{
    id: 'essentials-output',
    formatId: 'essentials',
    name: 'Essentials',
    width: 400,
    height: 300,
    durationMs: 6000,
    tracks: [
      {
        id: 'image-track', type: 'image',
        clips: [{
          id: 'image-original', originId: 'shared-image', src: ASYMMETRIC_URL,
          fileId: 'old-image-file', originalSrc: ASYMMETRIC_URL,
          originalFileId: 'old-image-file', smartFilters: [{ id: 'blur', enabled: true }],
          filters: ['sepia:0.2'], crop: { x: 0, y: 0, width: 2, height: 2 },
          startMs: 0, endMs: 4000, x: 20, y: 20, width: 120, height: 60,
          naturalWidth: 8, naturalHeight: 2, keyframes: [],
        }],
      },
      {
        id: 'shape-track', type: 'shape',
        clips: [{
          id: 'shape-original', shape: 'rect', startMs: 0, endMs: 6000,
          x: 200, y: 20, width: 100, height: 100, fill: '#ff0000',
        }],
      },
      {
        id: 'text-track', type: 'text',
        clips: [{
          id: 'text-original', text: 'Style me', startMs: 0, endMs: 6000,
          x: 20, y: 180, width: 250, height: 50, fontSize: 32,
          fontWeight: 400, fontStyle: 'normal', fill: '#ffffff',
        }],
      },
    ],
  }],
});

const motionDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'video',
  outputs: [{
    width: 1080,
    height: 1920,
    durationMs: 12_000,
    tracks: [
      {
        id: 'video-a',
        type: 'video',
        clips: [{
          id: 'clip-a',
          src: GENERATED_URL,
          startMs: 0,
          endMs: 2000,
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
          naturalWidth: 720,
          naturalHeight: 1280,
        }],
      },
      { id: 'video-b', type: 'video', clips: [] },
      {
        id: 'shape-a',
        type: 'shape',
        clips: [{
          id: 'shape-1',
          shape: 'rect',
          startMs: 0,
          endMs: 8000,
          x: 40,
          y: 40,
          width: 220,
          height: 120,
          fill: '#ff0000',
        }],
      },
      {
        id: 'text-a',
        type: 'text',
        clips: [{
          id: 'text-1',
          text: 'Resize me',
          startMs: 0,
          endMs: 8000,
          x: 60,
          y: 300,
          width: 220,
          height: 50,
          fontSize: 32,
          align: 'left',
          fill: '#ffffff',
        }],
      },
    ],
  }],
});

const clipOnTrack = (page: Page, label: string) =>
  page
    .getByTitle(label.toLowerCase(), { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"items-stretch")][1]')
    .getByRole('slider', { name: 'Clip', exact: true });

test.describe('Designer motion graphics editing (mocked local document)', () => {
  test('track drops, keyboard moves, canvas resize/style/duplicate, and reload persistence', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    await mocks.install(page);
    await openDesigner(page, mocks);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(3);

    await clipOnTrack(page, 'Video 1').first().click();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips.length).toBe(2);
    const duplicateId = mocks.doc.outputs[0].tracks[0].clips[1].id;
    expect(duplicateId).not.toBe('clip-a');

    let source = await clipOnTrack(page, 'Video 1').nth(1).boundingBox();
    const target = await page.getByTitle('video 2', { exact: true }).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => mocks.doc.outputs[0].tracks[1].clips[0]?.id).toBe(duplicateId);
    expect(mocks.doc.outputs[0].tracks.filter((track) => track.type === 'video')).toHaveLength(2);

    source = await clipOnTrack(page, 'Video 2').first().boundingBox();
    const lastTrack = await page.getByTitle('text', { exact: true }).boundingBox();
    expect(source).not.toBeNull();
    expect(lastTrack).not.toBeNull();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(source!.x + source!.width / 2, lastTrack!.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => mocks.doc.outputs[0].tracks.filter((track) => track.type === 'video').length).toBe(3);

    const moved = clipOnTrack(page, 'Video 3').first();
    await moved.focus();
    await moved.press('ArrowRight');
    await expect.poll(() => {
      const clip = mocks.savedClips().find((item) => item.id === duplicateId);
      return clip ? [clip.startMs, clip.endMs] : [];
    }).toEqual([100, 2100]);

    await clipOnTrack(page, 'Text').first().click();
    await page.keyboard.press('Control+0');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const stage = await page.locator('.konvajs-content').first().boundingBox();
    expect(stage).not.toBeNull();
    const zoom = Math.min(stage!.width / 1080, stage!.height / 1920) * 0.85;
    const viewportX = (stage!.width - 1080 * zoom) / 2;
    const viewportY = (stage!.height - 1920 * zoom) / 2;
    const handleX = stage!.x + viewportX + 280 * zoom;
    const handleY = stage!.y + viewportY + 350 * zoom;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 110 * zoom, handleY + 25 * zoom, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-1')?.fontSize).toBe(48);
    const resizedText = mocks.savedClips().find((clip) => clip.id === 'text-1');
    expect(resizedText?.width).toBeGreaterThan(320);
    expect(resizedText?.width).toBeLessThan(340);
    expect(resizedText?.height).toBeGreaterThan(70);
    expect(resizedText?.height).toBeLessThan(80);

    await clipOnTrack(page, 'Shape').first().click();
    await page.getByRole('radio', { name: 'Gradient', exact: true }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'shape-1')?.fillGradient?.stops.length).toBe(2);

    await clipOnTrack(page, 'Text').first().click();
    await page.getByRole('radio', { name: 'Justify', exact: true }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-1')?.align).toBe('justify');

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(4);
    expect(mocks.doc.version).toBe(9);
    expect(mocks.doc.outputs[0].tracks.filter((track) => track.type === 'video')).toHaveLength(3);
    expect(mocks.savedClips().find((clip) => clip.id === duplicateId)).toMatchObject({ startMs: 100, endMs: 2100 });
    const persistedText = mocks.savedClips().find((clip) => clip.id === 'text-1');
    expect(persistedText).toMatchObject({ fontSize: 48, align: 'justify' });
    expect(persistedText?.width).toBeGreaterThan(320);
    expect(persistedText?.width).toBeLessThan(340);
    expect(persistedText?.height).toBeGreaterThan(70);
    expect(persistedText?.height).toBeLessThan(80);
    expect(mocks.savedClips().find((clip) => clip.id === 'shape-1')?.fillGradient?.stops).toHaveLength(2);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

test.describe('Designer animated stock media (local non-paid fixture)', () => {
  test('MP4 sticker insertion plays, seeks, saves and reopens as a video clip', async ({ page }) => {
    const mocks = new DesignerMocks();
    await mocks.install(page);
    await openDesigner(page, mocks);

    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sticker…', exact: true }).click();
    await page.getByRole('button', { name: 'QA animated sticker', exact: true }).click();
    await expect.poll(() => mocks.savedClips()[0]?.mediaType).toBe('video');
    expect(mocks.doc.outputs[0].tracks[0]).toMatchObject({ type: 'video' });
    expect(mocks.savedClips()[0]).toMatchObject({
      src: STOCK_STICKER_URL,
      startMs: 0,
      endMs: 4000,
      width: 720,
      height: 1280,
      naturalWidth: 720,
      naturalHeight: 1280,
    });
    expect(mocks.doc.outputs[0].tracks.some((track) => track.type === 'image')).toBe(false);

    await expectRealPlayback(page);
    const seek = page.getByRole('slider', { name: 'Seek timeline', exact: true });
    await seek.press('Home');
    await seek.press('Shift+ArrowRight');
    await expect.poll(() => page.locator('video').first().evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.75);

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);
    expect(mocks.savedClips()[0]).toMatchObject({
      src: STOCK_STICKER_URL,
      mediaType: 'video',
      endMs: 4000,
      width: 720,
      height: 1280,
      naturalWidth: 720,
      naturalHeight: 1280,
    });
    await expectRealPlayback(page);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

test.describe('Designer video Inspector and timeline essentials (mocked local document)', () => {
  test('timeline tools, image replacement/removal, radius/text styles, and save/reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const mocks = new DesignerMocks();
    mocks.doc = essentialsDoc();
    mocks.name = 'Video essentials E2E';
    await mocks.install(page);
    await openDesigner(page, mocks);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(3);

    await clipOnTrack(page, 'Image').click();
    const split = page.getByRole('button', { name: 'Split clip', exact: true });
    await expect(split).toBeDisabled();
    const seek = page.getByRole('slider', { name: 'Seek timeline', exact: true });
    await seek.press('Home');
    await seek.press('Shift+ArrowRight');
    await expect(split).toBeEnabled();
    await split.click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips.length).toBe(2);
    expect(mocks.doc.outputs[0].tracks[0].clips.map((clip) => [clip.startMs, clip.endMs])).toEqual([
      [0, 1000], [1000, 4000],
    ]);

    for (const [trim, expectedLabel] of [
      [page.getByRole('slider', { name: 'Trim clip end', exact: true }).first(), 'Trim clip end'],
      [page.getByRole('slider', { name: 'Trim clip start', exact: true }).nth(1), 'Trim clip start'],
    ] as const) {
      const box = await trim.boundingBox();
      expect(box).not.toBeNull();
      const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
      const hitLabel = await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute('aria-label'), point);
      expect(hitLabel).toBe(expectedLabel);
      await page.mouse.click(point.x, point.y);
      await expect(page.getByRole('dialog', { name: 'Transition', exact: true })).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Duplicate clip', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips.length).toBe(3);
    await page.getByRole('button', { name: 'Delete clip', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips.length).toBe(2);
    await page.getByRole('button', { name: 'Cut transition', exact: true }).click();
    await page.getByRole('dialog', { name: 'Transition', exact: true })
      .getByRole('button', { name: 'Fade', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips[0].transitionOut?.type).toBe('fade');
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips[1].transitionIn?.type).toBe('fade');
    await page.getByRole('spinbutton', { name: 'Duration (seconds)', exact: true }).fill('8');
    await expect.poll(() => mocks.doc.outputs[0].durationMs).toBe(8000);

    await clipOnTrack(page, 'Image').nth(1).click();
    const beforeReplacement = mocks.doc.outputs[0].tracks[0].clips[1];
    await page.getByRole('button', { name: 'Replace image…', exact: true }).click();
    await page.getByText('replacement-image.png', { exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips[1]?.src).toBe(REPLACEMENT_IMAGE_URL);
    const replaced = mocks.doc.outputs[0].tracks[0].clips[1];
    expect(replaced).toMatchObject({
      id: beforeReplacement.id,
      originId: beforeReplacement.originId,
      startMs: beforeReplacement.startMs,
      endMs: beforeReplacement.endMs,
      x: beforeReplacement.x,
      y: beforeReplacement.y,
      width: beforeReplacement.width,
      height: beforeReplacement.height,
      keyframes: beforeReplacement.keyframes,
      filters: beforeReplacement.filters,
      fileId: 'replacement-image-file',
      mediaType: 'image',
      naturalWidth: 8,
      naturalHeight: 2,
    });
    expect(replaced.crop).toEqual(beforeReplacement.crop);
    expect(replaced.originalSrc).toBeUndefined();
    expect(replaced.originalFileId).toBeUndefined();
    expect(replaced.smartFilters).toBeUndefined();

    await page.getByRole('button', { name: 'Remove Background', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Processing...', exact: true })).toBeVisible();
    const review = page.getByRole('dialog', { name: 'Review background removal', exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByRole('img', { name: 'Before', exact: true })).toBeVisible();
    await expect(review.getByRole('img', { name: 'After', exact: true })).toBeVisible();
    expect(mocks.doc.outputs[0].tracks[0].clips[1]?.src).toBe(REPLACEMENT_IMAGE_URL);
    await review.getByRole('radio', { name: 'Preserve frame', exact: true }).click();
    await review.getByRole('button', { name: 'Apply result', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips[1]?.maskSrc).toContain('/mock-masks/');
    expect(mocks.backgroundRemovalPosts).toHaveLength(1);
    expect(JSON.parse(mocks.backgroundRemovalPosts[0])).toEqual({ imageUrl: REPLACEMENT_IMAGE_URL });
    const transparent = mocks.doc.outputs[0].tracks[0].clips[1];
    expect(transparent.id).toBe(beforeReplacement.id);
    expect(transparent.src).toBe(REPLACEMENT_IMAGE_URL);
    expect(transparent.filters).toEqual(beforeReplacement.filters);
    expect(transparent.smartFilters).toBeUndefined();
    expect(transparent.originalSrc).toBe(REPLACEMENT_IMAGE_URL);
    expect(transparent.originalFileId).toBe('replacement-image-file');
    expect(transparent.maskEnabled).toBe(true);
    expect(transparent.fitMode).toBe('contain');
    expect(transparent).toMatchObject({
      x: beforeReplacement.x,
      y: beforeReplacement.y,
      width: beforeReplacement.width,
      height: beforeReplacement.height,
    });

    await clipOnTrack(page, 'Shape').click();
    await page.getByRole('button', { name: 'Per corner', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Top right', exact: true }).fill('18');
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'shape-original')?.borderRadius)
      .toEqual([0, 18, 0, 0]);

    await clipOnTrack(page, 'Text').click();
    for (const [label, fontWeight, fontStyle] of [
      ['Bold', 700, 'normal'],
      ['Italic', 400, 'italic'],
      ['Bold Italic', 700, 'italic'],
      ['Normal', 400, 'normal'],
      ['Bold Italic', 700, 'italic'],
    ] as const) {
      await page.getByRole('radio', { name: label, exact: true }).click();
      await expect.poll(() => {
        const clip = mocks.savedClips().find((item) => item.id === 'text-original');
        return clip ? [clip.fontWeight, clip.fontStyle] : [];
      }).toEqual([fontWeight, fontStyle]);
    }
    await page.getByRole('radio', { name: 'Gradient', exact: true }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-original')?.fillGradient?.stops.length).toBe(2);
    await page.getByRole('switch', { name: 'Outline', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Outline width', exact: true }).fill('6');
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-original')?.textStroke?.width).toBe(6);

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(4);
    await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(1);
    expect(mocks.doc.version).toBe(14);
    expect(mocks.doc.outputs[0].durationMs).toBe(8000);
    expect(mocks.doc.outputs[0].tracks[0].clips).toHaveLength(2);
    expect(mocks.doc.outputs[0].tracks[0].clips[1]).toMatchObject({
      id: beforeReplacement.id,
      originId: beforeReplacement.originId,
      startMs: 1000,
      endMs: 4000,
      src: REPLACEMENT_IMAGE_URL,
      filters: beforeReplacement.filters,
      naturalWidth: 8,
      naturalHeight: 2,
      maskSrc: expect.stringContaining('/mock-masks/'),
      maskEnabled: true,
    });
    expect(mocks.savedClips().find((clip) => clip.id === 'shape-original')?.borderRadius)
      .toEqual([0, 18, 0, 0]);
    expect(mocks.savedClips().find((clip) => clip.id === 'text-original')).toMatchObject({
      fontWeight: 700,
      fontStyle: 'italic',
      textStroke: { color: '#000000', width: 6 },
    });
    expect(mocks.savedClips().find((clip) => clip.id === 'text-original')?.fillGradient?.stops).toHaveLength(2);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

async function openStaticDesigner(page: Page, mocks: DesignerMocks) {
  await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Save (Ctrl+S)' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.konvajs-content').first()).toBeVisible();
}

async function fitDesignerCanvas(page: Page) {
  await page.keyboard.press('Control+0');
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function canvasDocumentPoint(
  page: Page,
  outputWidth: number,
  outputHeight: number,
  x: number,
  y: number
) {
  const stage = await page.locator('.konvajs-content').first().boundingBox();
  expect(stage).not.toBeNull();
  const zoom = Math.min(stage!.width / outputWidth, stage!.height / outputHeight) * 0.85;
  return {
    x: stage!.x + (stage!.width - outputWidth * zoom) / 2 + x * zoom,
    y: stage!.y + (stage!.height - outputHeight * zoom) / 2 + y * zoom,
  };
}

async function canvasRgbaAtDocumentPoint(
  page: Page,
  outputWidth: number,
  outputHeight: number,
  x: number,
  y: number
): Promise<number[]> {
  const point = await canvasDocumentPoint(page, outputWidth, outputHeight, x, y);
  return page.evaluate(({ x: clientX, y: clientY }) => {
    const canvas = document.elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLCanvasElement => element instanceof HTMLCanvasElement);
    if (!canvas) throw new Error('No canvas at document point');
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext('2d')!;
    const pixelX = Math.max(0, Math.min(canvas.width - 1, Math.round((clientX - rect.left) * canvas.width / rect.width)));
    const pixelY = Math.max(0, Math.min(canvas.height - 1, Math.round((clientY - rect.top) * canvas.height / rect.height)));
    return Array.from(context.getImageData(pixelX, pixelY, 1, 1).data);
  }, point);
}

async function renderedFrameRgba(
  page: Page,
  mocks: DesignerMocks,
  x: number,
  y: number
): Promise<number[]> {
  const output = mocks.doc.outputs[0];
  await page.setContent(buildFramePage({
    outputLiteral: escapeForScriptTag(output),
    baseUrlLiteral: '"https://app.postmill.ai"',
    baseUrl: 'https://app.postmill.ai',
    script: FRAME_RENDERER_SCRIPT,
    fontLinks: '',
  }), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__FRAME_API);
  await page.evaluate(() => (window as any).__FRAME_API.renderFrame(0));
  return page.locator('#frame-canvas').evaluate((canvas, point) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')!;
    return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
  }, { x, y });
}

async function cropFromRightHandle(
  page: Page,
  outputWidth: number,
  outputHeight: number,
  right: number,
  centerY: number,
  targetX: number
) {
  await fitDesignerCanvas(page);
  const start = await canvasDocumentPoint(page, outputWidth, outputHeight, right, centerY);
  const end = await canvasDocumentPoint(page, outputWidth, outputHeight, targetX, centerY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

async function analyzeDownloadedPng(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const at = (x: number, y: number) => {
      const index = (y * canvas.width + x) * 4;
      return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
    };
    const bounds = (predicate: (r: number, g: number, b: number) => boolean) => {
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const [r, g, b] = at(x, y);
          if (!predicate(r, g, b)) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return { minX, minY, maxX, maxY };
    };
    return {
      width: canvas.width,
      height: canvas.height,
      red: bounds((r, g, b) => r > 180 && g < 80 && b < 80),
      green: bounds((r, g, b) => g > 180 && r < 80 && b < 80),
      backgroundTop: at(10, 10),
      backgroundBottom: at(10, canvas.height - 10),
      cropTopLeft: at(110, 60),
      cropTopRight: at(160, 60),
      cropBottomLeft: at(110, 120),
      cropBottomRight: at(160, 120),
    };
  }, png.toString('base64')) as Promise<{
    width: number;
    height: number;
    red: PixelBounds;
    green: PixelBounds;
    backgroundTop: number[];
    backgroundBottom: number[];
    cropTopLeft: number[];
    cropTopRight: number[];
    cropBottomLeft: number[];
    cropBottomRight: number[];
  }>;
}

test.describe('Designer crop and browser export artifacts (mocked local document)', () => {
  test('static crop persists aspect geometry and downloads focal/cropped PNG pixels', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    mocks.name = 'Static crop E2E';
    await mocks.install(page);
    await openStaticDesigner(page, mocks);

    await fitDesignerCanvas(page);
    const imageCenter = await canvasDocumentPoint(page, 400, 300, 150, 100);
    await page.mouse.click(imageCenter.x, imageCenter.y);
    await page.getByRole('button', { name: 'Crop (C)', exact: true }).click();
    await cropFromRightHandle(page, 400, 300, 300, 100, 200);
    await page.keyboard.press('Enter');

    await expect.poll(() => mocks.doc.outputs[0].children?.[0]?.crop?.width).toBeCloseTo(2, 0);
    const cropped = mocks.doc.outputs[0].children![0];
    expect(cropped.x).toBeCloseTo(100, 0);
    expect(cropped.y).toBeCloseTo(50, 0);
    expect(cropped.width).toBeCloseTo(100, 0);
    expect(cropped.height).toBeCloseTo(100, 0);
    expect(cropped.crop!.x).toBeCloseTo(3, 0);
    expect(cropped.crop!.y).toBeCloseTo(0, 0);
    expect(cropped.crop!.width).toBeCloseTo(2, 0);
    expect(cropped.crop!.height).toBeCloseTo(2, 0);
    expect(cropped.width! / cropped.height!).toBeCloseTo(cropped.crop!.width / cropped.crop!.height, 8);

    await page.keyboard.press('Control+e');
    await expect(page.getByText('Export Design', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next: Choose Folder', exact: true }).click();
    await page.getByRole('button', { name: 'Next: Export 1 file', exact: true }).click();
    await page.getByRole('button', { name: 'Export 1 file', exact: true }).click();
    await expect(page.getByText('Exports are saved in Media → Files. Download a copy to your computer:', { exact: true }))
      .toBeVisible({ timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: /\.png$/ }).click();
    const download = await downloadPromise;
    const png = fs.readFileSync((await download.path())!);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const pixels = await analyzeDownloadedPng(page, png);

    expect(pixels.width).toBe(400);
    expect(pixels.height).toBe(300);
    expect(pixels.red.minX).toBe(100);
    expect(pixels.red.minY).toBe(50);
    expect(pixels.red.maxX).toBeGreaterThanOrEqual(130);
    expect(pixels.red.maxX).toBeLessThan(160);
    expect(pixels.red.maxY).toBeGreaterThanOrEqual(80);
    expect(pixels.red.maxY).toBeLessThan(110);
    expect(pixels.green.minX).toBe(100);
    expect(pixels.green.minY).toBeGreaterThanOrEqual(90);
    expect(pixels.green.maxX).toBeGreaterThanOrEqual(130);
    expect(pixels.green.maxX).toBeLessThan(160);
    expect(pixels.green.maxY).toBeGreaterThanOrEqual(130);
    expect(pixels.green.maxY).toBeLessThan(160);
    expect(pixels.backgroundTop[2]).toBeGreaterThan(100);
    expect(pixels.backgroundTop[2]).toBeGreaterThan(pixels.backgroundTop[0]);
    expect(pixels.backgroundTop[2]).toBeGreaterThan(pixels.backgroundTop[1]);
    expect(pixels.backgroundBottom[0]).toBeGreaterThan(100);
    expect(pixels.backgroundBottom[1]).toBeGreaterThan(100);
    expect(pixels.backgroundBottom[0]).toBeGreaterThan(pixels.backgroundBottom[2] + 50);
    expect(pixels.backgroundBottom[1]).toBeGreaterThan(pixels.backgroundBottom[2] + 50);
    expect(pixels.cropTopLeft[0]).toBeGreaterThan(pixels.cropTopLeft[1] + 50);
    expect(pixels.cropTopLeft[0]).toBeGreaterThan(pixels.cropTopLeft[2] + 50);
    expect(pixels.cropTopRight[2]).toBeGreaterThan(pixels.cropTopRight[0] + 50);
    expect(pixels.cropTopRight[2]).toBeGreaterThan(pixels.cropTopRight[1] + 50);
    expect(pixels.cropBottomLeft[1]).toBeGreaterThan(pixels.cropBottomLeft[0] + 50);
    expect(pixels.cropBottomLeft[1]).toBeGreaterThan(pixels.cropBottomLeft[2] + 50);
    expect(pixels.cropBottomRight[0]).toBeGreaterThan(pixels.cropBottomRight[2] + 50);
    expect(pixels.cropBottomRight[1]).toBeGreaterThan(pixels.cropBottomRight[2] + 50);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });

  test('video crop UI saves and reloads aspect-correct source and destination geometry', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = videoCropDoc();
    await mocks.install(page);
    await openDesigner(page, mocks);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);

    await page.getByRole('slider', { name: 'Clip', exact: true }).click();
    await fitDesignerCanvas(page);
    const clipCenter = await canvasDocumentPoint(page, 400, 300, 150, 90);
    await page.mouse.click(clipCenter.x, clipCenter.y);
    await page.getByRole('button', { name: 'Crop (C)', exact: true }).click();
    await cropFromRightHandle(page, 400, 300, 250, 90, 150);
    await page.keyboard.press('Enter');

    await expect.poll(() => mocks.savedClips()[0]?.crop?.height).toBeCloseTo(360, 0);
    const assertGeometry = () => {
      const clip = mocks.savedClips()[0];
      expect(clip.x).toBeCloseTo(50, 0);
      expect(clip.y).toBeCloseTo(40, 0);
      expect(clip.width).toBeCloseTo(100, 0);
      expect(clip.height).toBeCloseTo(100, 0);
      expect(clip).toMatchObject({ naturalWidth: 720, naturalHeight: 1280, fitMode: 'cover' });
      expect(clip.crop!.x).toBeCloseTo(0, 0);
      expect(clip.crop!.y).toBeCloseTo(690, 0);
      // Fractional canvas scaling can quantize the half-width drag by ~2 source px.
      expect(clip.crop!.width).toBeGreaterThan(358);
      expect(clip.crop!.width).toBeLessThan(361.5);
      expect(clip.crop!.height).toBeGreaterThan(359);
      expect(clip.crop!.height).toBeLessThan(361.5);
      expect(clip.width! / clip.height!).toBeCloseTo(clip.crop!.width / clip.crop!.height, 8);
    };
    assertGeometry();

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(1);
    await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(1);
    assertGeometry();
    expect(mocks.doc.version).toBe(9);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

test.describe('Designer posters and custom fonts (mocked local document)', () => {
  test('custom and current-frame posters survive polling, post-render switching, and Files', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    await mocks.install(page);
    await openDesigner(page, mocks);

    const timeline = page.getByRole('slider', { name: 'Seek timeline', exact: true });
    await timeline.focus();
    await timeline.press('Home');
    for (let index = 0; index < 10; index++) await timeline.press('ArrowRight');
    await expect(timeline).toHaveAttribute('aria-valuenow', '1000');

    await page.keyboard.press('Control+e');
    await page.getByRole('button', { name: 'Next: Choose Folder', exact: true }).click();
    await page.getByRole('button', { name: 'Next: Export 1 file', exact: true }).click();
    await page.getByLabel('Upload custom poster', { exact: true }).setInputFiles(
      path.join(__dirname, '../fixtures/asymmetric-8x2.png'),
    );
    await expect(page.getByRole('img', { name: 'Selected poster', exact: true }))
      .toHaveAttribute('src', CUSTOM_POSTER_URL);
    await page.getByRole('button', { name: 'Use current timeline frame', exact: true }).click();
    await page.getByRole('button', { name: 'Start Render', exact: true }).click();
    await expect(page.getByText('Render Complete', { exact: true })).toBeVisible();

    expect(mocks.renderRequests).toHaveLength(1);
    expect(mocks.renderRequests[0]).toMatchObject({
      posterUrl: CUSTOM_POSTER_URL,
      posterTimeMs: 1000,
    });
    expect(mocks.renderFile.thumbnail).toBe(CUSTOM_POSTER_URL);
    expect(mocks.renderFile.thumbnailTimestamp).toBe(1000);
    expect(mocks.renderFile.metadata.generatedPosterUrl).toBe(GENERATED_POSTER_URL);
    await expect(page.getByRole('img', { name: 'Custom poster', exact: true }))
      .toHaveAttribute('src', CUSTOM_POSTER_URL);

    await page.getByRole('button', { name: 'Use rendered poster', exact: true }).click();
    await expect.poll(() => mocks.renderFile.thumbnail).toBe(GENERATED_POSTER_URL);
    await page.getByLabel('Upload custom poster', { exact: true }).setInputFiles(
      path.join(__dirname, '../fixtures/asymmetric-8x2.png'),
    );
    await expect.poll(() => mocks.renderFile.thumbnail).toBe(CUSTOM_POSTER_URL);
    expect(mocks.fileInformationUpdates).toHaveLength(2);
    expect(mocks.fileInformationUpdates[1]).toMatchObject({
      id: 'file-rendered-e2e',
      thumbnail: CUSTOM_POSTER_URL,
      thumbnailTimestamp: 1000,
    });

    await page.goto('/files', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('img[src*="custom-poster.png"]').first()).toBeVisible();
    await page.getByText('designer-render.mp4', { exact: true }).dblclick();
    await page.getByLabel('Upload custom thumbnail', { exact: true }).setInputFiles(
      path.join(__dirname, '../fixtures/asymmetric-8x2.png'),
    );
    await expect(page.getByText('Thumbnail updated', { exact: true })).toBeVisible();
    expect(mocks.fileInformationUpdates).toHaveLength(3);
    expect(mocks.fileInformationUpdates[2]).toMatchObject({
      id: 'file-rendered-e2e',
      thumbnail: CUSTOM_POSTER_URL,
    });
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });

  test('two real TTF uploads are sequential, usable, loaded, and persistent across reloads', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    await mocks.install(page);
    await openDesigner(page, mocks);
    await clipOnTrack(page, 'Text').first().click();
    await page.getByRole('button', { name: /^Inter/ }).click();

    await page.getByLabel('Upload font file', { exact: true }).setInputFiles([
      path.join(__dirname, '../../apps/frontend/public/fonts/WendyOne-Regular.ttf'),
      path.join(__dirname, '../../apps/frontend/public/fonts/PlaywriteGBJ-VariableFont_wght.ttf'),
    ]);
    await expect.poll(() => mocks.customFonts.length).toBe(2);
    expect(mocks.fontUploads).toEqual([
      'WendyOne-Regular.ttf',
      'PlaywriteGBJ-VariableFont_wght.ttf',
    ]);

    await page.getByRole('button', { name: /^Wendy One/ }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-1')?.fontFamily)
      .toBe('Wendy One');
    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await clipOnTrack(page, 'Text').first().click();
    await page.getByRole('button', { name: /^Wendy One/ }).click();
    await page.getByRole('button', { name: /^Playwrite GB J/ }).click();
    await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'text-1')?.fontFamily)
      .toBe('Playwrite GB J');
    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    expect(mocks.savedClips().find((clip) => clip.id === 'text-1')?.fontFamily).toBe('Playwrite GB J');
    expect(mocks.customFonts.map((font) => font.family)).toEqual(['Wendy One', 'Playwrite GB J']);
    await expect.poll(() => page.evaluate(() =>
      Array.from(document.fonts)
        .filter((face) => /Wendy One|Playwrite GB J/.test(face.family))
        .map((face) => `${face.family.replace(/["']/g, '')}:${face.status}`)
    )).toEqual(expect.arrayContaining(['Wendy One:loaded', 'Playwrite GB J:loaded']));
    expect(mocks.fontUploads).toHaveLength(2);
    mocks.expectClean();
  });
});

const groupingDoc = (): DesignerDocSnapshot => ({
  version: 10,
  mode: 'video',
  outputs: [{
    id: 'grouping-output',
    formatId: 'grouping',
    name: 'Grouping',
    width: 400,
    height: 300,
    durationMs: 4000,
    tracks: [{
      id: 'grouping-shapes',
      type: 'shape',
      clips: [
        { id: 'clip-a', shape: 'rect', fill: '#ff0000', startMs: 0, endMs: 4000, x: 40, y: 40, width: 60, height: 50 },
        { id: 'clip-b', shape: 'rect', fill: '#00ff00', startMs: 0, endMs: 4000, x: 150, y: 40, width: 60, height: 50 },
        { id: 'clip-c', shape: 'rect', fill: '#0000ff', startMs: 0, endMs: 4000, x: 40, y: 160, width: 60, height: 50 },
      ],
    }],
  }],
});

async function dragDocumentPoints(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

test.describe('Designer video canvas movement and grouping (mocked local document)', () => {
  test('real pointer drag, shift/marquee selection, group move, reload, and one-step undo', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = groupingDoc();
    mocks.name = 'Video grouping E2E';
    await mocks.install(page);
    await openDesigner(page, mocks);
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(3);
    await fitDesignerCanvas(page);

    const point = (x: number, y: number) => canvasDocumentPoint(page, 400, 300, x, y);
    const clip = (id: string) => mocks.savedClips().find((item) => item.id === id)!;
    const expectPosition = async (id: string, x: number, y: number) => {
      await expect.poll(() => clip(id).x).toBeCloseTo(x, 0);
      await expect.poll(() => clip(id).y).toBeCloseTo(y, 0);
    };
    const clickPoint = async (x: number, y: number) => {
      const target = await point(x, y);
      await page.mouse.click(target.x, target.y);
    };

    await dragDocumentPoints(page, await point(70, 65), await point(100, 85));
    await expectPosition('clip-a', 70, 60);
    await page.keyboard.press('Control+z');
    await expectPosition('clip-a', 40, 40);
    await expectPosition('clip-b', 150, 40);

    await clickPoint(370, 260);
    await clickPoint(70, 65);
    await page.keyboard.down('Shift');
    await clickPoint(180, 65);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Control+g');
    await expect.poll(() => clip('clip-a').groupId).toBeTruthy();
    expect(clip('clip-b').groupId).toBe(clip('clip-a').groupId);
    expect(clip('clip-c').groupId).toBeUndefined();

    await dragDocumentPoints(page, await point(70, 65), await point(100, 85));
    await expectPosition('clip-a', 70, 60);
    await expectPosition('clip-b', 180, 60);
    await expectPosition('clip-c', 40, 160);
    await page.keyboard.press('Control+z');
    await expectPosition('clip-a', 40, 40);
    await expectPosition('clip-b', 150, 40);
    await page.keyboard.press('Control+Shift+z');
    await expectPosition('clip-a', 70, 60);
    await expectPosition('clip-b', 180, 60);

    await saveDesign(page);
    const savedGroupId = clip('clip-a').groupId;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('slider', { name: 'Clip', exact: true })).toHaveCount(3);
    await expect.poll(() => mocks.dashboardJobReads).toBeGreaterThan(1);
    await expectPosition('clip-a', 70, 60);
    await expectPosition('clip-b', 180, 60);
    expect(clip('clip-a').groupId).toBe(savedGroupId);
    expect(clip('clip-b').groupId).toBe(savedGroupId);

    await fitDesignerCanvas(page);
    await clickPoint(100, 85);
    await page.keyboard.press('Control+Shift+g');
    await expect.poll(() => clip('clip-a').groupId).toBeUndefined();
    expect(clip('clip-b').groupId).toBeUndefined();

    await clickPoint(370, 260);
    await dragDocumentPoints(page, await point(5, 5), await point(270, 125));
    await page.keyboard.press('Control+g');
    await expect.poll(() => clip('clip-a').groupId).toBeTruthy();
    expect(clip('clip-b').groupId).toBe(clip('clip-a').groupId);
    expect(clip('clip-c').groupId).toBeUndefined();

    await dragDocumentPoints(page, await point(100, 85), await point(110, 90));
    await expectPosition('clip-a', 80, 65);
    await expectPosition('clip-b', 190, 65);
    await expectPosition('clip-c', 40, 160);
    await page.keyboard.press('Control+z');
    await expectPosition('clip-a', 70, 60);
    await expectPosition('clip-b', 180, 60);

    await page.keyboard.press('ArrowRight');
    await expectPosition('clip-a', 71, 60);
    await expectPosition('clip-b', 181, 60);
    await page.keyboard.press('Control+z');
    await expectPosition('clip-a', 70, 60);
    await expectPosition('clip-b', 180, 60);
    await page.keyboard.press('Delete');
    await expect.poll(() => mocks.savedClips().map((item) => item.id)).toEqual(['clip-c']);
    await page.keyboard.press('Control+z');
    await expect.poll(() => mocks.savedClips().map((item) => item.id).sort()).toEqual(['clip-a', 'clip-b', 'clip-c']);
    await expectPosition('clip-a', 70, 60);
    await expectPosition('clip-b', 180, 60);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

async function touchDragDocumentPoints(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  holdMs = 0
) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y }],
  });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: start.x + (end.x - start.x) * step / 8,
        y: start.y + (end.y - start.y) * step / 8,
      }],
    });
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

async function selectMobileTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('region', { name: 'Tools', exact: true }).getByRole('button', { name, exact: true }).click();
  await page.keyboard.press('Escape');
}

test.describe('Designer mobile touch editing (mocked local document)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('draws and taps shapes, moves text by its full box, edits, saves, and reloads', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    mocks.doc.outputs[0].children = [{
      id: 'mobile-text',
      type: 'text',
      text: 'Move me',
      x: 40,
      y: 40,
      width: 200,
      height: 80,
      fontFamily: 'Arial',
      fontSize: 32,
      fontWeight: 400,
      fill: '#ffffff',
    }];
    mocks.name = 'Mobile touch E2E';
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await fitDesignerCanvas(page);
    const point = (x: number, y: number) => canvasDocumentPoint(page, 400, 300, x, y);

    await selectMobileTool(page, 'Rectangle');
    await touchDragDocumentPoints(page, await point(250, 150), await point(350, 250));
    await expect.poll(() => mocks.doc.outputs[0].children?.filter((item) => item.type === 'shape').length).toBe(1);

    const tap = await point(100, 200);
    await page.touchscreen.tap(tap.x, tap.y);
    await expect.poll(() => mocks.doc.outputs[0].children?.filter((item) => item.type === 'shape').length).toBe(2);

    await selectMobileTool(page, 'Move');
    await touchDragDocumentPoints(page, await point(225, 105), await point(285, 165));
    await expect.poll(() => mocks.doc.outputs[0].children?.find((item) => item.id === 'mobile-text')?.x).toBeGreaterThan(40);
    const moved = mocks.doc.outputs[0].children!.find((item) => item.id === 'mobile-text')!;
    expect(moved.y).toBeGreaterThan(40);

    const editPoint = await point(moved.x! + 100, moved.y! + 40);
    await page.touchscreen.tap(editPoint.x, editPoint.y);
    await page.touchscreen.tap(editPoint.x, editPoint.y);
    const editor = page.locator('[data-text-editor-id="mobile-text"]');
    await expect(editor).toBeVisible();
    await editor.fill('Mobile edited');
    await selectMobileTool(page, 'Move');
    await expect.poll(() => mocks.doc.outputs[0].children?.find((item) => item.id === 'mobile-text')?.text).toBe('Mobile edited');

    await page.keyboard.press('Control+s');
    await expect.poll(() => mocks.designWrites).toBeGreaterThan(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    expect(mocks.doc.outputs[0].children?.filter((item) => item.type === 'shape')).toHaveLength(2);
    expect(mocks.doc.outputs[0].children?.find((item) => item.id === 'mobile-text')).toMatchObject({
      text: 'Mobile edited',
      x: moved.x,
      y: moved.y,
    });
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });

  test('uses mobile quick actions, bottom tools, Inspector, and a collapsible timeline', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = blankDoc();
    mocks.name = 'Mobile workspace E2E';
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await fitDesignerCanvas(page);

    await expect(page.getByRole('toolbar', { name: 'Designer quick actions', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse timeline', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse timeline', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Expand timeline', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const toolsDialog = page.getByRole('region', { name: 'Tools', exact: true });
    await toolsDialog.getByRole('button', { name: 'Horizontal Type', exact: true }).click();
    await toolsDialog.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await expect(toolsDialog.getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await toolsDialog.getByLabel('Radius', { exact: true }).fill('18');
    await expect(toolsDialog.getByLabel('Radius', { exact: true })).toHaveValue('18');
    await page.keyboard.press('Escape');
    const point = await canvasDocumentPoint(page, 1080, 1920, 540, 960);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => mocks.savedClips().length).toBe(1);
    expect(mocks.savedClips()[0].borderRadius).toBe(18);
    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click();
    await page.getByRole('slider', { name: 'Clip', exact: true }).click();
    const quickActions = page.getByRole('toolbar', { name: 'Designer quick actions', exact: true });
    await quickActions.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect.poll(() => mocks.savedClips().length).toBe(2);
    await quickActions.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => mocks.savedClips().length).toBe(1);

    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await expect(page.getByText('Inspector', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => mocks.designWrites).toBeGreaterThan(0);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });

  test('applies Brand styles and inserts a logo in a video design', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = blankDoc();
    mocks.name = 'Mobile Brand E2E';
    mocks.brand = {
      id: 'brand-e2e',
      name: 'E2E Brand',
      palette: ['#123456'],
      fontFamilies: ['Georgia'],
      logoFileIds: ['replacement-image-file'],
      isDefault: true,
    };
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await fitDesignerCanvas(page);

    await selectMobileTool(page, 'Horizontal Type');
    const point = await canvasDocumentPoint(page, 1080, 1920, 540, 960);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => mocks.savedClips().length).toBe(1);
    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click();
    await page.getByRole('slider', { name: 'Clip', exact: true }).click();

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('region', { name: 'Tools', exact: true }).getByRole('button', { name: 'Brand', exact: true }).click();
    await page.getByRole('button', { name: '#123456', exact: true }).click();
    await expect.poll(() => mocks.savedClips()[0]?.fill).toBe('#123456');
    await page.getByRole('button', { name: 'Georgia', exact: true }).click();
    await expect.poll(() => mocks.savedClips()[0]?.fontFamily).toBe('Georgia');

    await page.getByRole('button', { name: 'replacement-image.png', exact: true }).click();
    await expect.poll(() => mocks.savedClips().length).toBe(2);
    expect(mocks.savedClips()[1]).toMatchObject({
      fileId: 'replacement-image-file',
      src: REPLACEMENT_IMAGE_URL,
      mediaType: 'image',
    });
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });

  test('generates and applies AI copy and design suggestions', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = blankDoc();
    mocks.name = 'Mobile AI assistant E2E';
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await fitDesignerCanvas(page);

    await selectMobileTool(page, 'Horizontal Type');
    const point = await canvasDocumentPoint(page, 1080, 1920, 540, 960);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => mocks.savedClips().length).toBe(1);
    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click();
    await page.getByRole('slider', { name: 'Clip', exact: true }).click();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();

    await page.getByRole('textbox', { name: 'Design brief', exact: true }).fill('Holiday sale');
    await page.getByRole('button', { name: 'Generate copy', exact: true }).click();
    await page.getByRole('button', { name: 'Apply text', exact: true }).first().click();
    await expect.poll(() => mocks.savedClips()[0]?.text).toBe('AI holiday headline');
    expect(mocks.assistantCopyPosts).toHaveLength(1);
    expect(mocks.assistantCopyPosts[0]).toContain('Holiday sale');
    expect(mocks.assistantCopyPosts[0]).not.toContain('/uploads/');

    await page.getByRole('button', { name: 'Smart suggestions', exact: true }).click();
    await page.getByRole('button', { name: 'Apply style', exact: true }).click();
    await expect.poll(() => mocks.savedClips()[0]?.fontFamily).toBe('Georgia');
    expect(mocks.savedClips()[0]?.fill).toBe('#123456');
    expect(mocks.assistantSuggestionPosts).toHaveLength(1);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

test.describe('Designer stock vectors and repeated output dimensions', () => {
  test('adds the same preset twice with unique names that survive save and reload', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    mocks.doc.outputs[0].formatId = 'ig-post';
    mocks.doc.outputs[0].name = 'Instagram Post';
    await mocks.install(page);
    await openStaticDesigner(page, mocks);

    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: 'Add format', exact: true }).click();
      const checkbox = page.getByRole('checkbox', { name: /Instagram Post/ });
      expect((await checkbox.isDisabled()).valueOf()).toBe(false);
      await checkbox.click();
      await page.getByRole('button', { name: 'Add 1 format', exact: true }).click();
    }

    await expect.poll(() => mocks.doc.outputs.length).toBe(3);
    expect(mocks.doc.outputs.map((output) => output.formatId)).toEqual(['ig-post', 'ig-post', 'ig-post']);
    expect(mocks.doc.outputs.map((output) => output.name)).toEqual([
      'Instagram Post', 'Instagram Post 2', 'Instagram Post 3',
    ]);
    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Instagram Post 3', { exact: true })).toBeVisible();
    expect(mocks.doc.outputs).toHaveLength(3);
    mocks.expectClean();
  });

  test('imports an SVG vector to an owned PNG before inserting it', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    await mocks.install(page);
    await openStaticDesigner(page, mocks);

    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Vector…', exact: true }).click();
    await page.getByRole('button', { name: 'QA outline vector', exact: true }).click();

    await expect.poll(() => mocks.doc.outputs[0].children?.some(
      (element) => element.fileId === 'vector-file-1' && element.src === IMPORTED_VECTOR_URL
    )).toBe(true);
    expect(mocks.doc.outputs[0].children?.some(
      (element) => element.src === STOCK_VECTOR_URL
    )).toBe(false);
    mocks.expectClean();
  });

  test('recolors an outline stock icon on the canvas', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    mocks.doc.outputs[0].background = '#ffffff';
    delete mocks.doc.outputs[0].bg;
    mocks.doc.outputs[0].children = [];
    await mocks.install(page);
    await openStaticDesigner(page, mocks);

    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Stock Icon…', exact: true }).click();
    await page.getByRole('button', { name: 'QA outline icon', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].children?.[0]?.type).toBe('icon');
    const before = await canvasFingerprint(page);

    await page.getByRole('button', { name: '#2B5CD3', exact: true }).click();
    await page.getByRole('textbox', { name: 'Hex color', exact: true }).fill('#123456');
    await page.getByRole('textbox', { name: 'Hex color', exact: true }).press('Enter');
    await expect.poll(() => mocks.doc.outputs[0].children?.[0]?.fill).toBe('#123456');
    expect(await canvasFingerprint(page)).not.toBe(before);
    mocks.expectClean();
  });
});

test.describe('Designer mobile workspace', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test('moves a clip across tracks, trims it, and enters exact timing with one undo', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click();
    const clip = page.getByRole('slider', { name: 'Clip', exact: true }).first();
    await clip.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const box = await clip.boundingBox();
    expect(box).not.toBeNull();
    const grabX = box!.x + box!.width / 2;
    await touchDragDocumentPoints(
      page,
      { x: grabX, y: box!.y + box!.height / 2 },
      { x: grabX + 50, y: box!.y + box!.height / 2 + 40 }
    );
    await expect.poll(() => mocks.doc.outputs[0].tracks[1].clips[0]?.startMs).toBeGreaterThan(0);
    const moved = mocks.doc.outputs[0].tracks[1].clips[0];
    const movedDuration = moved.endMs - moved.startMs;

    const endHandle = page.getByRole('slider', { name: 'Trim clip end', exact: true }).first();
    await endHandle.scrollIntoViewIfNeeded();
    const endBox = await endHandle.boundingBox();
    expect(endBox).not.toBeNull();
    await touchDragDocumentPoints(
      page,
      { x: endBox!.x + endBox!.width / 2, y: endBox!.y + endBox!.height / 2 },
      { x: endBox!.x + endBox!.width / 2 - 12, y: endBox!.y + endBox!.height / 2 }
    );
    await expect.poll(() => {
      const current = mocks.doc.outputs[0].tracks[1].clips[0];
      return current.endMs - current.startMs;
    }).toBeLessThan(movedDuration);
    const trimmedDuration = (() => {
      const current = mocks.doc.outputs[0].tracks[1].clips[0];
      return current.endMs - current.startMs;
    })();

    const duration = page.getByRole('toolbar', { name: 'Video timeline', exact: true })
      .getByRole('spinbutton', { name: 'Duration (s)', exact: true });
    await duration.fill('1.5');
    await duration.press('Enter');
    await expect.poll(() => {
      const current = mocks.doc.outputs[0].tracks[1].clips[0];
      return current.endMs - current.startMs;
    }).toBe(1500);
    expect(mocks.doc.outputs[0].durationMs).toBe(12000);

    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Inspector', exact: true })
      .getByRole('spinbutton', { name: 'Duration (s)', exact: true })).toHaveValue('1.5');
    await page.getByRole('toolbar', { name: 'Designer quick actions', exact: true })
      .getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => {
      const current = mocks.doc.outputs[0].tracks[1].clips[0];
      return current.endMs - current.startMs;
    }).toBe(trimmedDuration);
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });

  test('auto-scrolls clip timing with a held pointer but not a stationary long-press', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click();
    const clip = page.getByRole('slider', { name: 'Clip', exact: true }).first();
    await clip.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const box = await clip.boundingBox();
    expect(box).not.toBeNull();
    const scroller = page.getByRole('toolbar', { name: 'Video timeline', exact: true })
      .locator('.overflow-auto').first();
    const scrollRect = await scroller.boundingBox();
    expect(scrollRect).not.toBeNull();
    await touchDragDocumentPoints(
      page,
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
      { x: scrollRect!.x + scrollRect!.width - 4, y: box!.y + box!.height / 2 },
      1200
    );
    await expect.poll(() => mocks.doc.outputs[0].tracks[0].clips[0].startMs).toBeGreaterThan(1000);
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    const beforeLongPress = await scroller.evaluate((element) => element.scrollLeft);
    const longPressClip = page.getByRole('slider', { name: 'Clip', exact: true }).first();
    const longPressBox = await longPressClip.boundingBox();
    expect(longPressBox).not.toBeNull();
    await touchDragDocumentPoints(
      page,
      { x: longPressBox!.x + longPressBox!.width / 2, y: longPressBox!.y + longPressBox!.height / 2 },
      { x: longPressBox!.x + longPressBox!.width / 2, y: longPressBox!.y + longPressBox!.height / 2 },
      650
    );
    expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(beforeLongPress);
    await page.keyboard.press('Escape');
    mocks.expectClean();
  });

  test('renames, fits the timeline, and keeps canvas-visible sheets with snap states', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = blankDoc();
    mocks.name = 'Mobile before rename';
    mocks.brand = {
      id: 'brand-e2e', name: 'E2E Brand', palette: ['#123456'],
      fontFamilies: ['Georgia'], logoFileIds: ['replacement-image-file'], isDefault: true,
    };
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('textbox', { name: 'Design name', exact: true }).fill('Mobile renamed E2E');
    await expect.poll(() => mocks.name).toBe('Mobile renamed E2E');

    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    const canvasSheet = page.getByRole('region', { name: 'Canvas', exact: true });
    await expect(canvasSheet).toHaveClass(/h-\[32dvh\]/);
    await canvasSheet.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(canvasSheet).toHaveClass(/h-\[65dvh\]/);
    await canvasSheet.getByRole('button', { name: 'Half', exact: true }).click();
    await expect(canvasSheet).toHaveClass(/h-\[32dvh\]/);
    await canvasSheet.getByRole('button', { name: 'Collapse panel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Canvas', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const toolsSheet = page.getByRole('region', { name: 'Tools', exact: true });
    await toolsSheet.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(toolsSheet).toHaveClass(/h-\[65dvh\]/);
    await toolsSheet.getByRole('button', { name: 'Collapse panel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tools', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('region', { name: 'Tools', exact: true })
      .getByRole('button', { name: 'Brand', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Brand', exact: true })).toBeVisible();
    await page.getByRole('region', { name: 'Brand', exact: true })
      .getByRole('button', { name: 'Collapse panel', exact: true }).click();

    await page.getByRole('button', { name: 'Zoom to fit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Collapse timeline', exact: true })).toBeVisible();
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

test.describe('Designer desktop Brand rail', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('opens the existing Brand panel directly from the tool rail', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = blankDoc();
    mocks.brand = {
      id: 'brand-e2e', name: 'E2E Brand', palette: ['#123456'],
      fontFamilies: ['Georgia'], logoFileIds: ['replacement-image-file'], isDefault: true,
    };
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Brand', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Brand', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: '#123456', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Collapse panel', exact: true }).click();
    await expect(panel).toBeHidden();
    expect(mocks.generatePosts).toHaveLength(0);
    mocks.expectClean();
  });
});

test.describe('Designer non-destructive cutout refinement', () => {
  test('keeps a vertically asymmetric mask aligned with a letterboxed image', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    delete mocks.doc.outputs[0].bg;
    Object.assign(mocks.doc.outputs[0].children![0], {
      src: CUTOUT_VERTICAL_SOURCE_URL,
      fileId: 'source-file',
      originalSrc: CUTOUT_VERTICAL_SOURCE_URL,
      originalFileId: 'source-file',
      naturalWidth: 8,
      naturalHeight: 2,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      fitMode: 'fill',
      crop: undefined,
      focalPoint: undefined,
    });
    await mocks.install(page);
    await openStaticDesigner(page, mocks);
    await fitDesignerCanvas(page);
    const center = await canvasDocumentPoint(page, 400, 300, 200, 150);
    await page.mouse.click(center.x, center.y);

    await page.getByRole('button', { name: 'Remove Background', exact: true }).click();
    await page.getByRole('button', { name: 'Apply result', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].children![0].maskSrc).toContain('/mock-masks/');

    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 200, 50)).toEqual([0, 0, 0, 255]);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 200, 125)).toEqual([255, 0, 0, 255]);
    await expect.poll(async () => {
      const rgba = await canvasRgbaAtDocumentPoint(page, 400, 300, 200, 175);
      return rgba[0] === 0 && rgba[1] === 0 && rgba[2] <= 2 && rgba[3] === 255;
    }).toBe(true);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 200, 250)).toEqual([0, 0, 0, 255]);
    expect(mocks.doc.outputs[0].children![0]).toMatchObject({
      src: CUTOUT_VERTICAL_SOURCE_URL,
      fitMode: 'contain',
    });
    mocks.expectClean();
  });

  test('double-clicking masked text opens the text editor', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    mocks.doc.outputs[0].children = [{
      id: 'masked-text',
      type: 'text',
      text: 'Masked headline',
      x: 40,
      y: 40,
      width: 320,
      height: 80,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fontSize: 40,
      fontFamily: 'Inter',
      fill: '#ffffff',
      maskSrc: CUTOUT_RESULT_URL,
      maskEnabled: true,
    }];
    await mocks.install(page);
    await openStaticDesigner(page, mocks);
    await fitDesignerCanvas(page);
    const text = await canvasDocumentPoint(page, 400, 300, 180, 80);
    await page.mouse.dblclick(text.x, text.y);

    await expect(page.locator('[data-text-editor-id="masked-text"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    mocks.expectClean();
  });

  test('retains original pixels and restores, erases, undoes, and reloads a static cutout', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    delete mocks.doc.outputs[0].bg;
    const image = mocks.doc.outputs[0].children![0];
    Object.assign(image, {
      src: CUTOUT_SOURCE_URL,
      fileId: 'source-file',
      originalSrc: CUTOUT_SOURCE_URL,
      originalFileId: 'source-file',
      naturalWidth: 8,
      naturalHeight: 2,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      fitMode: 'fill',
      crop: undefined,
      focalPoint: undefined,
    });
    await mocks.install(page);
    await openStaticDesigner(page, mocks);
    await fitDesignerCanvas(page);
    const center = await canvasDocumentPoint(page, 400, 300, 200, 150);
    await page.mouse.click(center.x, center.y);

    await page.getByRole('button', { name: 'Remove Background', exact: true }).click();
    await page.getByRole('button', { name: 'Apply result', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].children![0].maskSrc).toContain('/mock-masks/');
    expect(mocks.doc.outputs[0].children![0]).toMatchObject({
      src: CUTOUT_SOURCE_URL,
      fileId: 'source-file',
      originalSrc: CUTOUT_SOURCE_URL,
      originalFileId: 'source-file',
      maskEnabled: true,
    });
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 250, 150)).toEqual([0, 0, 0, 255]);

    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Brush size', exact: true }).fill('500');
    const restoredMask = mocks.doc.outputs[0].children![0].maskSrc;
    const restorePoint = await canvasDocumentPoint(page, 400, 300, 250, 150);
    await page.mouse.click(restorePoint.x, restorePoint.y);
    await expect.poll(() => mocks.doc.outputs[0].children![0].maskSrc).not.toBe(restoredMask);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 250, 150)).toEqual([0, 0, 255, 255]);

    await page.getByRole('button', { name: 'Erase', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Brush size', exact: true }).fill('500');
    const erasedMask = mocks.doc.outputs[0].children![0].maskSrc;
    const erasePoint = await canvasDocumentPoint(page, 400, 300, 150, 150);
    await page.mouse.click(erasePoint.x, erasePoint.y);
    await expect.poll(() => mocks.doc.outputs[0].children![0].maskSrc).not.toBe(erasedMask);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([0, 0, 0, 255]);

    await page.keyboard.press('Control+z');
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([255, 0, 0, 255]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([0, 0, 0, 255]);

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await fitDesignerCanvas(page);
    expect(mocks.doc.outputs[0].children![0].maskSrc).toContain('/mock-masks/');
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([0, 0, 0, 255]);

    const reselected = await canvasDocumentPoint(page, 400, 300, 200, 150);
    await page.mouse.click(reselected.x, reselected.y);
    await page.getByRole('button', { name: 'Show original', exact: true }).click();
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 250, 150)).toEqual([0, 0, 255, 255]);
    await page.getByRole('button', { name: 'Show cutout', exact: true }).click();
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([0, 0, 0, 255]);
    mocks.expectClean();
  });

  test('applies a still-image clip mask in the overlay and real video-frame renderer', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = motionDoc();
    mocks.doc.outputs[0].width = 400;
    mocks.doc.outputs[0].height = 300;
    mocks.doc.outputs[0].durationMs = 4000;
    const track = mocks.doc.outputs[0].tracks[0];
    mocks.doc.outputs[0].tracks = [track];
    track.type = 'image';
    Object.assign(track.clips[0], {
      src: CUTOUT_SOURCE_URL,
      fileId: 'source-file',
      originalSrc: CUTOUT_SOURCE_URL,
      originalFileId: 'source-file',
      mediaType: 'image',
      naturalWidth: 8,
      naturalHeight: 2,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      fitMode: 'fill',
    });
    await mocks.install(page);
    await openDesigner(page, mocks);
    await fitDesignerCanvas(page);
    await page.getByRole('slider', { name: 'Clip', exact: true }).first().click();

    await page.getByRole('button', { name: 'Remove Background', exact: true }).click();
    await page.getByRole('button', { name: 'Apply result', exact: true }).click();
    await expect.poll(() => mocks.savedClips()[0].maskSrc).toContain('/mock-masks/');
    expect(mocks.savedClips()[0]).toMatchObject({
      src: CUTOUT_SOURCE_URL,
      fileId: 'source-file',
      originalSrc: CUTOUT_SOURCE_URL,
      originalFileId: 'source-file',
      mediaType: 'image',
      maskEnabled: true,
    });
    const framePage = await page.context().newPage();
    await mocks.install(framePage);
    await expect.poll(() => renderedFrameRgba(framePage, mocks, 150, 150)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => renderedFrameRgba(framePage, mocks, 250, 150)).toEqual([0, 0, 0, 255]);
    await framePage.close();
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 250, 150)).toEqual([0, 0, 0, 255]);

    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Brush size', exact: true }).fill('500');
    const restoredMask = mocks.savedClips()[0].maskSrc;
    const restorePoint = await canvasDocumentPoint(page, 400, 300, 250, 150);
    await page.mouse.click(restorePoint.x, restorePoint.y);
    await expect.poll(() => mocks.savedClips()[0].maskSrc).not.toBe(restoredMask);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 250, 150)).toEqual([0, 0, 255, 255]);

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    expect(mocks.savedClips()[0].maskSrc).toContain('/mock-masks/');
    await fitDesignerCanvas(page);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 150, 150)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 300, 250, 150)).toEqual([0, 0, 255, 255]);
    await expect.poll(() => renderedFrameRgba(page, mocks, 150, 150)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => renderedFrameRgba(page, mocks, 250, 150)).toEqual([0, 0, 255, 255]);
    mocks.expectClean();
  });
});

const pathfinderDoc = (count = 3): DesignerDocSnapshot => {
  const doc = staticCropDoc();
  doc.outputs[0].children = Array.from({ length: count }, (_, index) => ({
    id: `shape-${index + 1}`,
    name: `Shape ${index + 1}`,
    type: 'shape',
    shape: 'rect',
    x: index * 50,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: '#ff0000',
  }));
  return doc;
};

async function selectPathfinderShapes(page: Page, count: number) {
  if (count < 2) throw new Error('Pathfinder tests require at least two shapes');
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
  await page.getByRole('menuitem', { name: 'All Layers', exact: false }).click();
}

async function runPathfinder(page: Page, operation: string) {
  await page.getByRole('menuitem', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pathfinder', exact: false }).hover();
  await page.getByRole('menuitem', { name: operation, exact: true }).click();
}

test.describe('Designer multi-shape Pathfinder', () => {
  test('unites three selected shapes and restores them with one undo', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = pathfinderDoc();
    await mocks.install(page);
    await openStaticDesigner(page, mocks);

    await selectPathfinderShapes(page, 3);
    await runPathfinder(page, 'Unite');

    await expect.poll(() => mocks.doc.outputs[0].children).toHaveLength(1);
    expect(mocks.doc.outputs[0].children![0]).toMatchObject({ type: 'path' });
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].children).toHaveLength(3);
    mocks.expectClean();
  });

  test('preserves a contained result as one even-odd compound path', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = pathfinderDoc(2);
    mocks.doc.outputs[0].children![0].width = 200;
    Object.assign(mocks.doc.outputs[0].children![1], { x: 50, y: 20, width: 100, height: 60 });
    await mocks.install(page);
    await openStaticDesigner(page, mocks);

    await selectPathfinderShapes(page, 2);
    await runPathfinder(page, 'Minus Front');

    await expect.poll(() => mocks.doc.outputs[0].children).toHaveLength(1);
    expect(mocks.doc.outputs[0].children![0]).toMatchObject({
      type: 'path',
      fillRule: 'evenodd',
    });
    expect(mocks.doc.outputs[0].children![0].subpaths).toHaveLength(2);
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
    await expect.poll(() => mocks.doc.outputs[0].children).toHaveLength(2);
    mocks.expectClean();
  });
});

const staticBlendDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'image',
  outputs: [{
    id: 'blend-static',
    formatId: 'blend-static',
    name: 'Blend static',
    width: 400,
    height: 100,
    background: '#ffffff',
    tracks: [],
    children: [
      { id: 'base-left', type: 'shape', shape: 'rect', fill: '#3a7bd5', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      { id: 'base-right', type: 'shape', shape: 'rect', fill: '#d53a7b', x: 100, y: 0, width: 300, height: 100, rotation: 0, opacity: 1 },
      { id: 'text', type: 'text', text: 'B', fontFamily: 'Inter', fontSize: 72, fill: '#808080', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      { id: 'shape', type: 'shape', shape: 'rect', fill: '#808080', x: 100, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      { id: 'image', type: 'image', src: REPLACEMENT_IMAGE_URL, fileId: 'replacement-image-file', naturalWidth: 8, naturalHeight: 2, fitMode: 'fill', x: 200, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      { id: 'group', type: 'group', x: 300, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
      { id: 'group-child', parentId: 'group', type: 'shape', shape: 'rect', fill: '#808080', x: 300, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    ],
  }],
});

const videoBlendDoc = (): DesignerDocSnapshot => ({
  version: 9,
  mode: 'video',
  outputs: [{
    id: 'blend-video',
    formatId: 'blend-video',
    name: 'Blend video',
    width: 400,
    height: 300,
    durationMs: 4000,
    tracks: [
      {
        id: 'blend-base', type: 'shape',
        clips: [{ id: 'blend-base-clip', shape: 'rect', fill: '#3a7bd5', startMs: 0, endMs: 4000, x: 0, y: 0, width: 400, height: 300 }],
      },
      {
        id: 'blend-shape', type: 'shape',
        clips: [{ id: 'blend-shape-clip', shape: 'rect', fill: '#808080', startMs: 0, endMs: 4000, x: 50, y: 50, width: 100, height: 100 }],
      },
      {
        id: 'blend-image', type: 'image',
        clips: [{ id: 'blend-image-clip', src: REPLACEMENT_IMAGE_URL, fileId: 'replacement-image-file', mediaType: 'image', naturalWidth: 8, naturalHeight: 2, fitMode: 'fill', startMs: 0, endMs: 4000, x: 200, y: 50, width: 100, height: 100 }],
      },
    ],
  }],
});

test.describe('Designer blend controls and renderer parity', () => {
  test('applies the shared Inspector selector to text, shape, image and groups with visible output and persistence', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticBlendDoc();
    await mocks.install(page);
    await openStaticDesigner(page, mocks);
    await fitDesignerCanvas(page);
    const select = page.getByRole('combobox', { name: 'Blend mode', exact: true });
    const normal = [128, 128, 128, 255];

    for (const [id, x] of [['text', 50], ['shape', 150], ['image', 250]] as const) {
      const point = await canvasDocumentPoint(page, 400, 100, x, 50);
      await page.mouse.click(point.x, point.y);
      await expect(select).toBeVisible();
      for (const blendMode of ['multiply', 'screen', 'overlay', 'soft-light']) {
        await select.selectOption(blendMode);
        await expect.poll(() => mocks.doc.outputs[0].children!.find((el) => el.id === id)?.blendMode).toBe(blendMode);
        if (id === 'shape') {
          await expect.poll(() => canvasRgbaAtDocumentPoint(page, 400, 100, 150, 50)).not.toEqual(normal);
        }
      }
    }

    await page.keyboard.press('Control+k');
    await page.getByRole('button', { name: 'Layers View', exact: true }).click();
    await page.getByRole('option', { name: /\bGroup\b/ }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    for (const blendMode of ['multiply', 'screen', 'overlay', 'soft-light']) {
      await select.selectOption(blendMode);
      await expect.poll(() => mocks.doc.outputs[0].children!.find((el) => el.id === 'group')?.blendMode).toBe(blendMode);
    }

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    for (const id of ['text', 'shape', 'image', 'group']) {
      expect(mocks.doc.outputs[0].children!.find((el) => el.id === id)?.blendMode).toBe('soft-light');
    }
    mocks.expectClean();
  });

  test('preserves native clip modes in the Inspector and real frame renderer', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = videoBlendDoc();
    await mocks.install(page);
    await openDesigner(page, mocks);
    const framePage = await page.context().newPage();
    await mocks.install(framePage);
    const select = page.getByRole('combobox', { name: 'Blend', exact: true });
    const normal = [128, 128, 128, 255];

    await page.getByRole('slider', { name: 'Clip', exact: true }).nth(1).click();
    for (const blendMode of ['multiply', 'screen', 'overlay', 'soft-light']) {
      await select.selectOption(blendMode);
      await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'blend-shape-clip')?.blendMode).toBe(blendMode);
      await expect.poll(() => renderedFrameRgba(framePage, mocks, 100, 100)).not.toEqual(normal);
    }
    await framePage.close();

    await clipOnTrack(page, 'Image').click();
    for (const blendMode of ['multiply', 'screen', 'overlay', 'soft-light']) {
      await select.selectOption(blendMode);
      await expect.poll(() => mocks.savedClips().find((clip) => clip.id === 'blend-image-clip')?.blendMode).toBe(blendMode);
    }

    await saveDesign(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    expect(mocks.savedClips().find((clip) => clip.id === 'blend-shape-clip')?.blendMode).toBe('soft-light');
    expect(mocks.savedClips().find((clip) => clip.id === 'blend-image-clip')?.blendMode).toBe('soft-light');
    mocks.expectClean();
  });
});

test.describe('Designer mobile workspace', () => {
  test('exposes the shared blend selector in the Inspector', async ({ page }) => {
    const mocks = new DesignerMocks();
    mocks.doc = staticCropDoc();
    await mocks.install(page);
    await page.goto(`/media/designer?designId=${DESIGN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await fitDesignerCanvas(page);
    const center = await canvasDocumentPoint(page, 400, 300, 200, 150);
    await page.mouse.click(center.x, center.y);
    const inspectorButton = page.getByRole('button', { name: 'Inspector', exact: true });
    if (await inspectorButton.isVisible()) await inspectorButton.click();

    const select = page.getByRole('combobox', { name: 'Blend mode', exact: true });
    await expect(select).toBeVisible();
    await select.selectOption('soft-light');
    await expect.poll(() => mocks.doc.outputs[0].children![0].blendMode).toBe('soft-light');
    mocks.expectClean();
  });
});

test.describe('Designer rich text editing (real browser)', () => {
  test('Enter preserves text and pasted styles survive autosave and reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const mocks = new DesignerMocks();
    mocks.doc = richTextDoc();
    mocks.name = 'Rich text browser E2E';
    await mocks.install(page);
    await openStaticDesigner(page, mocks);
    await page.keyboard.press('Control+k');
    await page.getByRole('button', { name: 'Layers View', exact: true }).click();

    await page.getByRole('option', { name: /Original headline/ }).click();
    await page.getByRole('application', { name: 'Design canvas' }).focus();
    await page.keyboard.press('Enter');
    const editor = page.locator('[data-text-editor-id]');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('Original headline');

    const fallbacks = Array.from({ length: 30 }, (_, i) => `'Fallback ${i}'`).join(', ');
    const html = `<span style="font-family: 'Helvetica Neue', ${fallbacks}; font-size: 0.875em; font-weight: 700">Rich text persisted</span>`;
    await editor.evaluate((el, value) => {
      document.execCommand('insertHTML', false, value);
    }, html);
    await editor.evaluate((el) => el.blur());
    await expect.poll(() => mocks.designWrites, { timeout: 15_000 }).toBeGreaterThan(0);

    let child = mocks.doc.outputs[0].children![0];
    expect(child).toMatchObject({
      text: 'Rich text persisted',
      richText: [{ text: 'Rich text persisted', fontFamily: 'Helvetica Neue', fontWeight: 700 }],
    });
    expect(child.richText?.[0].fontSize).toBeUndefined();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('option', { name: /Rich text persisted/ }).click();
    await page.getByRole('application', { name: 'Design canvas' }).focus();
    await page.keyboard.press('Enter');
    await expect(editor).toHaveText('Rich text persisted');

    await editor.evaluate((el) => {
      const html = `<span style="font-weight:700">${'a'.repeat(12000)}</span><span style="font-style:italic">${'b'.repeat(8500)}</span>`;
      document.execCommand('insertHTML', false, html);
    });
    await editor.evaluate((el) => el.blur());
    await expect.poll(() => mocks.designWrites, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect(page.getByText('Pasted text was shortened to the 20,000-character limit.')).toBeVisible();

    child = mocks.doc.outputs[0].children![0];
    expect(child.text).toHaveLength(20000);
    expect(child.richText).toHaveLength(2);
    expect(child.richText?.[0].text).toHaveLength(12000);
    expect(child.richText?.[1].text).toHaveLength(8000);
    expect(child.richText?.[1].fontStyle).toBe('italic');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 60_000 });
    expect(mocks.doc.outputs[0].children![0].text).toHaveLength(20000);
    mocks.expectClean();
  });
});
