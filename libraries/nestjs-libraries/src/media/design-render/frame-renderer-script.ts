/**
 * Self-contained browser script used by ChromiumFrameCaptureService to render a
 * single frame of a VideoOutput composition. It is injected into a headless page
 * and mirrors the client-side composition logic in video-preview.ts and
 * video-canvas-overlay.tsx.
 */

/**
 * Serialize a value for safe interpolation inside an inline `<script>` block.
 * `JSON.stringify` does NOT escape `<` or `/`, so a user-controlled string containing
 * `</script><script>â¦</script>` would break out of the block and execute in the render
 * browser (SSRF/exfil on the `--no-sandbox` in-process path). Escaping `<` (which neutralizes
 * `</script`) plus the U+2028/U+2029 line separators (which break JS string literals) makes
 * the payload inert while remaining valid JSON to `JSON.parse`. Apply to EVERY value inlined
 * into a `<script>` (both the composition and the baseUrl).
 */
export function escapeForScriptTag(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

import { shapeGeometrySource } from '../designer-doc/shape-geometry';
import { keyframesSource } from '../designer-doc/keyframes';
import { speedCurveSource } from '../designer-doc/speed-curve';
import { motionBlurSource } from '../designer-doc/motion-blur';
import { captionStylesSource } from '../designer-doc/caption-styles';
import { backgroundTextureSource } from '../designer-doc/background-texture';
import { transitionsSource } from '../designer-doc/transitions';

/**
 * The ...Source() helpers serialize functions with String(fn). The backend runs
 * the CJS-compiled build, where tsc rewrites references to exported bindings as
 * `exports.X` — but `exports` does not exist in the frame page, so any leaked
 * reference throws ReferenceError the first time that code path runs (shapes,
 * easing helpers hit by keyframes/caption word-pop, …). Every `exports.X` name
 * is one of the module's own helpers, all declared locally in the injected
 * block, so stripping the prefix restores the intended reference.
 */
const stripExportsNamespace = (source: string): string =>
  source.replace(/\bexports\./g, '');

export const FRAME_RENDERER_SCRIPT = /* js */ `
(function () {
${stripExportsNamespace(shapeGeometrySource())}
${stripExportsNamespace(keyframesSource())}
${stripExportsNamespace(speedCurveSource())}
${stripExportsNamespace(motionBlurSource())}
${stripExportsNamespace(captionStylesSource())}
${stripExportsNamespace(backgroundTextureSource())}
${stripExportsNamespace(transitionsSource())}

  const output = window.__DATA.output;
  const baseUrl = window.__DATA.baseUrl || '';
  const canvas = document.getElementById('frame-canvas');
  const ctx = canvas.getContext('2d');
  // Render-time resolution multiplier (export option; NOT document content — it
  // is injected onto the composition copy the render pipeline serves). All
  // drawing below stays in logical canvas units; the transform supersamples it.
  const renderScale = Math.max(0.25, Math.min(4, output.renderScale || 1));
  canvas.width = Math.round(output.width * renderScale);
  canvas.height = Math.round(output.height * renderScale);
  ctx.scale(renderScale, renderScale);

  const imageCache = new Map();
  const videoCache = new Map();
  // Wedge bookkeeping for seekVideo: consecutive wedged seeks per element, and
  // the elements that already had their ONE reload.
  const videoWedges = new Map();
  const videoReloaded = new WeakSet();

  // Both timeouts stay at 5000ms: a legitimate seek CAN take seconds when the
  // CDN range re-fetch is merely slow, and halving it would false-positive
  // slow-but-healthy seeks into pointless reloads. The wedge streak
  // (3 x SEEK_TIMEOUT_MS) plus one reload still fails a frame in well under
  // the 30s frame watchdog (VIDEO_RENDER_FRAME_TIMEOUT_MS).
  const VIDEO_LOAD_FALLBACK_MS = 5000;
  const SEEK_TIMEOUT_MS = 5000;
  const WEDGE_RELOAD_THRESHOLD = 3;

  function resolveUrl(src) {
    if (!src) return src;
    if (/^(data:|https?:|blob:)/i.test(src)) return src;
    if (src.startsWith('//')) return 'https:' + src;
    const prefix = baseUrl.replace(/\\/$/, '');
    if (src.startsWith('/')) return prefix + src;
    return prefix + '/' + src;
  }

  function loadImage(src) {
    const url = resolveUrl(src);
    if (imageCache.has(url)) return imageCache.get(url);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('Image load failed: ' + url));
      img.src = url;
    });
    imageCache.set(url, p);
    return p;
  }

  function getVideo(src) {
    const url = resolveUrl(src);
    if (videoCache.has(url)) return videoCache.get(url);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    // Buffer the whole clip up front. The default ('metadata') lets the
    // browser discard the buffer under memory pressure; every seek then
    // re-fetches a CDN range, and a slow re-fetch wedges the seek — the
    // 10s/frame render stall this page now fails fast on.
    video.preload = 'auto';
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '0';
    document.body.appendChild(video);
    const ready = new Promise((resolve, reject) => {
      video.onloadeddata = () => resolve(video);
      video.onerror = (e) => reject(new Error('Video load failed: ' + url));
      // safety fallback
      setTimeout(() => resolve(video), VIDEO_LOAD_FALLBACK_MS);
    });
    videoCache.set(url, ready);
    return ready;
  }

  // One seek attempt: resolves true when 'seeked' lands, false when it wedges.
  // A wedged seek must not hang this page's stride forever — after the timeout
  // the frame draws whatever the video's currentTime happens to be.
  function attemptSeek(video, target) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', onSeeked);
        resolve(ok);
      };
      const onSeeked = () => done(true);
      video.addEventListener('seeked', onSeeked);
      setTimeout(() => {
        if (!settled && window.console && console.warn) {
          console.warn('seekVideo: seeked timeout after ' + SEEK_TIMEOUT_MS + 'ms, target=' + target);
        }
        done(false);
      }, SEEK_TIMEOUT_MS);
      video.currentTime = target;
    });
  }

  function waitForLoaded(video) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('loadeddata', onLoaded);
        resolve(undefined);
      };
      const onLoaded = () => done();
      video.addEventListener('loadeddata', onLoaded);
      setTimeout(done, VIDEO_LOAD_FALLBACK_MS);
    });
  }

  async function reloadAndReseek(video, target) {
    videoReloaded.add(video);
    if (window.console && console.warn) {
      console.warn('seekVideo: reloading wedged video element, target=' + target);
    }
    video.load();
    await waitForLoaded(video);
    return attemptSeek(video, target);
  }

  async function seekVideo(video, timeSec) {
    const target = Math.max(0, timeSec);
    if (Math.abs(video.currentTime - target) <= 0.033) return;
    if (await attemptSeek(video, target)) {
      // A clean seek proves the element recovered — reset the wedge streak.
      videoWedges.delete(video);
      return;
    }
    // A wedged seek silently draws stale pixels. Tolerate a few in a row
    // (transient CDN slowness), then reload the element ONCE and reseek; if it
    // still wedges, the element is unrecoverable in-page — throw so the frame
    // (and render) fails fast instead of every remaining frame burning
    // SEEK_TIMEOUT_MS on stale pixels until the job timeout.
    const wedges = (videoWedges.get(video) || 0) + 1;
    videoWedges.set(video, wedges);
    if (wedges < WEDGE_RELOAD_THRESHOLD) return;
    if (!videoReloaded.has(video) && (await reloadAndReseek(video, target))) {
      videoWedges.delete(video);
      return;
    }
    throw new Error(
      'seekVideo: video element still wedged after ' + wedges +
        ' consecutive seeks and a reload (target=' + target + ')'
    );
  }

  // Mirrors parseDesignerFilterToken + cssFilterForToken (filter-tokens.ts),
  // which this page cannot import. A drift spec pins the two together.
  // parseFloat of a missing value is NaN, not null — the old "== null"
  // guards never fired and this emitted literal brightness(NaN), which CSS
  // discards, silently dropping every adjustment on the clip.
  function mapFilterToken(token) {
    if (token === 'grayscale') return 'grayscale(100%)';
    if (token === 'sepia') return 'sepia(100%)';
    const parts = token.split(':');
    const key = parts[0];
    if (parts[1] === undefined) return '';
    const value = parseFloat(parts[1]);
    if (isNaN(value)) return '';
    switch (key) {
      case 'blur': return \`blur(\${value}px)\`;
      case 'brightness': return \`brightness(\${value})\`;
      case 'contrast': return \`contrast(\${value})\`;
      case 'saturate': return \`saturate(\${value})\`;
      default: return '';
    }
  }

  function applyFilters(ctx, filters, extraBlurPx) {
    const parts = (filters || []).map(mapFilterToken).filter(Boolean);
    // Transition blur rides the same canvas filter pipeline as clip filters —
    // one ctx.filter string, so the two never clobber each other.
    if (extraBlurPx > 0) parts.push('blur(' + extraBlurPx.toFixed(1) + 'px)');
    const str = parts.join(' ');
    if (str) ctx.filter = str;
  }

  // Mirrors canvasCompositeFor (designer-doc/pixel-ops.ts), which this page
  // cannot import — a drift spec pins the two together. The schema only lets a
  // clip carry native modes, so the value goes straight onto
  // globalCompositeOperation; 'normal'/absent spells 'source-over'.
  function clipCompositeOp(mode) {
    if (!mode || mode === 'normal') return 'source-over';
    return mode;
  }

  function computeCoverCrop(srcW, srcH, targetW, targetH, focalPoint) {
    const fp = focalPoint || { x: 0.5, y: 0.5 };
    const targetRatio = targetW / targetH;
    const srcRatio = srcW / srcH;
    let sw, sh;
    if (srcRatio > targetRatio) {
      sh = srcH;
      sw = srcH * targetRatio;
    } else {
      sw = srcW;
      sh = srcW / targetRatio;
    }
    const sx = (srcW - sw) * Math.min(1, Math.max(0, fp.x));
    const sy = (srcH - sh) * Math.min(1, Math.max(0, fp.y));
    return { sx, sy, sw, sh };
  }

  function getStickerFrameUrl(clip, relativeMs) {
    const frames = clip.frames;
    if (!frames || frames.length === 0) return clip.src;
    let loopMs = 0;
    for (const f of frames) loopMs += f.durationMs;
    if (loopMs <= 0) return frames[0].url;
    const t = relativeMs % loopMs;
    let acc = 0;
    for (const f of frames) {
      acc += f.durationMs;
      if (t < acc) return f.url;
    }
    return frames[frames.length - 1].url;
  }

  // Keyframe interpolation and easing come from the shared module as source
  // (see keyframesSource), so the preview and an exported mp4 ease identically.
  const interpolateKeyframes = interpolateClipKeyframes;

  function getClipDuration(clip) { return clip.endMs - clip.startMs; }
  function getEffectiveEnd(clip) { return clip.endMs + (clip.freezeAtMs || 0); }

  // The playhead→source mapping (constant speed, speed ramps, reverse,
  // freeze) is INJECTED from designer-doc/speed-curve (see speedCurveSource)
  // — the same implementation the preview engine runs, so an exported frame
  // seeks to exactly the source time the canvas showed. The former
  // hand-mirrored copy here had already drifted (it never froze a speed:0
  // clip); a spec pins the injected copy to the module.

  function getClipVisualState(clip, playheadMs) {
    const effectiveEnd = getEffectiveEnd(clip);
    if (playheadMs < clip.startMs || playheadMs > effectiveEnd) return null;
    const relativeMs = Math.max(0, playheadMs - clip.startMs);
    let props = interpolateKeyframes(clip, relativeMs);
    const fadeInEnd = clip.startMs + (clip.fadeInMs || 0);
    const fadeOutStart = effectiveEnd - (clip.fadeOutMs || 0);
    let visibleOpacity = props.opacity;
    if (clip.fadeInMs && playheadMs <= fadeInEnd) {
      visibleOpacity *= (playheadMs - clip.startMs) / clip.fadeInMs;
    }
    if (clip.fadeOutMs && playheadMs >= fadeOutStart) {
      visibleOpacity *= (effectiveEnd - playheadMs) / clip.fadeOutMs;
    }
    return { visible: true, props: { ...props, opacity: Math.max(0, Math.min(1, visibleOpacity)) } };
  }

  function findTransitionWindows(track) {
    if (track.type === 'audio') return [];
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    const windows = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const dur = Math.min(from.transitionOut?.durationMs || 0, to.transitionIn?.durationMs || 0);
      if (dur <= 0 || from.endMs > to.startMs) continue;
      windows.push({ fromClip: from, toClip: to, startMs: from.endMs - dur, endMs: from.endMs, durationMs: dur });
    }
    return windows;
  }

  function composeClipsAtPlayhead(vo, playheadMs) {
    const result = [];
    for (const track of vo.tracks) {
      // Hidden tracks are excluded from the render, exactly as the preview
      // engine's composer skips them.
      if (track.type === 'audio' || track.hidden) continue;
      const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
      const windows = findTransitionWindows(track);
      for (const clip of sorted) {
        const effectiveEnd = getEffectiveEnd(clip);
        let visible = playheadMs >= clip.startMs && playheadMs <= effectiveEnd;
        let transitionProgress;
        let isIncoming = false;
        const outgoing = windows.find((w) => w.fromClip.id === clip.id);
        if (outgoing && playheadMs >= outgoing.startMs && playheadMs <= outgoing.endMs) {
          visible = true;
          transitionProgress = outgoing.durationMs > 0 ? (playheadMs - outgoing.startMs) / outgoing.durationMs : 0;
        }
        const incoming = windows.find((w) => w.toClip.id === clip.id);
        if (incoming && playheadMs >= incoming.startMs && playheadMs <= incoming.endMs) {
          visible = true;
          transitionProgress = incoming.durationMs > 0 ? (playheadMs - incoming.startMs) / incoming.durationMs : 0;
          isIncoming = true;
        }
        if (!visible) continue;
        const relativeMs = Math.max(0, playheadMs - clip.startMs);
        let props = interpolateKeyframes(clip, relativeMs);
        const fadeState = getClipVisualState(clip, playheadMs);
        if (fadeState) props = fadeState.props;
        if (transitionProgress !== undefined) {
          const type = isIncoming ? clip.transitionIn?.type : clip.transitionOut?.type;
          const direction = isIncoming ? clip.transitionIn?.direction : clip.transitionOut?.direction;
          // The transition maths are INJECTED from designer-doc/transitions (see
          // transitionsSource) — the same implementation the preview runs.
          props = applyTransitionAdjustment(
            props,
            transitionAdjustment(type, direction, transitionProgress, isIncoming, props.width, props.height)
          );
        }
        result.push({ clip, trackType: track.type, props });
      }
    }
    return result;
  }

  async function drawImageOrVideoClip(ctx, clip, props, trackType) {
    const src = clip.src;
    if (!src && trackType !== 'sticker') return;
    let element;
    const isVideo = (clip.type === 'video' || (clip.src && /\\.(mp4|webm|mov|mkv|avi)(\\?.*)?$/i.test(clip.src)));
    if (isVideo) {
      element = await getVideo(src);
      const sourceTime = sourceTimeForPlayhead(clip, window.__CURRENT_TIME);
      if (sourceTime != null) {
        await seekVideo(element, sourceTime / 1000);
      }
    } else if (trackType === 'sticker' && clip.frames && clip.frames.length) {
      const relativeMs = Math.max(0, window.__CURRENT_TIME - clip.startMs);
      const frameUrl = getStickerFrameUrl(clip, relativeMs);
      element = await loadImage(frameUrl);
    } else {
      element = await loadImage(src);
    }
    if (!element) return;

    const nw = element.naturalWidth || element.videoWidth || props.width;
    const nh = element.naturalHeight || element.videoHeight || props.height;
    // Unset means fill, as it does in the preview and the still renderer. This
    // defaulted to 'contain', so a clip that filled its box in the editor
    // exported letterboxed.
    const fitMode = clip.fitMode || 'fill';

    ctx.save();
    applyFilters(ctx, clip.filters, props.blurPx);
    ctx.globalAlpha = props.opacity;

    if (clip.crop) {
      // An explicit crop is what the Crop tool wrote and beats fitMode's
      // automatic cover window — same precedence the canvas uses.
      const c = clip.crop;
      ctx.drawImage(
        element,
        Math.max(0, c.x),
        Math.max(0, c.y),
        Math.max(1, c.width),
        Math.max(1, c.height),
        0,
        0,
        props.width,
        props.height
      );
    } else if (fitMode === 'cover') {
      const { sx, sy, sw, sh } = computeCoverCrop(nw, nh, props.width, props.height, clip.focalPoint);
      ctx.drawImage(element, sx, sy, sw, sh, 0, 0, props.width, props.height);
    } else if (fitMode === 'fill') {
      ctx.drawImage(element, 0, 0, props.width, props.height);
    } else {
      const scale = Math.min(props.width / nw, props.height / nh);
      const dw = nw * scale;
      const dh = nh * scale;
      const dx = (props.width - dw) / 2;
      const dy = (props.height - dh) / 2;
      ctx.drawImage(element, 0, 0, nw, nh, dx, dy, dw, dh);
    }

    ctx.restore();
  }



  function wrapText(ctx, text, maxWidth) {
    const words = (text || '').split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // Shape clips. Polygon geometry comes from the injected shape-geometry
  // source, so this traces exactly what the canvas and the PDF renderer trace.
  function drawShapeClip(ctx, clip, props) {
    const w = props.width;
    const h = props.height;
    ctx.save();
    ctx.globalAlpha = props.opacity;
    ctx.fillStyle = clip.fill || '#2B5CD3';
    ctx.strokeStyle = clip.stroke || clip.fill || '#2B5CD3';
    ctx.lineWidth = clip.strokeWidth || 0;

    const points = pointsForShape(clip.shape, w, h, clip.sides, clip.innerRatio);
    if (points) {
      ctx.beginPath();
      points.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      if (clip.strokeWidth) ctx.stroke();
    } else if (clip.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (clip.strokeWidth) ctx.stroke();
    } else if (clip.shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.lineWidth = clip.strokeWidth || 2;
      ctx.stroke();
    } else {
      const r = Math.min(clip.borderRadius || 0, w / 2, h / 2);
      ctx.beginPath();
      if (r > 0 && ctx.roundRect) ctx.roundRect(0, 0, w, h, r);
      else ctx.rect(0, 0, w, h);
      ctx.fill();
      if (clip.strokeWidth) ctx.stroke();
    }
    ctx.restore();
  }

  function drawTextClip(ctx, clip, props) {
    const text = clip.text || '';
    if (!text) return;
    ctx.save();
    ctx.globalAlpha = props.opacity;
    const fontSize = clip.fontSize || 32;
    // Quoted: an unquoted multi-word family ("Bebas Neue") makes the whole
    // shorthand invalid, and the assignment is then silently ignored.
    ctx.font = \`\${clip.fontWeight || 400} \${fontSize}px "\${clip.fontFamily || 'sans-serif'}"\`;
    ctx.fillStyle = clip.fill || '#ffffff';
    ctx.textBaseline = 'top';
    const align = clip.align || 'left';
    ctx.textAlign = align;
    const lineHeight = fontSize * 1.2;
    const lines = wrapText(ctx, text, props.width);
    let y = 0;
    for (const line of lines) {
      let x = 0;
      if (align === 'center') x = props.width / 2;
      else if (align === 'right') x = props.width;
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    ctx.restore();
  }

  async function drawCaptionClip(ctx, clip, props, playheadMs) {
    const words = clip.words;
    if (!words || words.length === 0) return;
    ctx.save();
    ctx.globalAlpha = props.opacity;
    const fontSize = clip.fontSize || 28;
    const fontWeight = clip.fontWeight || 700;
    ctx.font = \`\${fontWeight} \${fontSize}px "\${clip.fontFamily || 'Arial'}"\`;
    ctx.textBaseline = 'top';
    const lineHeight = fontSize * 1.35;
    const spaceWidth = ctx.measureText(' ').width;
    const relativeMs = Math.max(0, playheadMs - clip.startMs);
    // Per-word styling comes from the shared module (see captionStylesSource),
    // so a karaoke caption looks the same here as in the editor.
    const states = captionWordStates(words, relativeMs, clip.captionStyle, clip.fill || '#ffffff');
    let x = 0;
    let y = 0;
    for (let i = 0; i < words.length; i++) {
      const state = states[i];
      const scaled = fontSize * state.scale;
      ctx.font = (state.weight || fontWeight) + ' ' + scaled + 'px "' + (clip.fontFamily || 'Arial') + '"';
      const wordWidth = ctx.measureText(words[i].word).width;
      if (x + wordWidth > props.width && x > 0) {
        x = 0;
        y += lineHeight;
      }
      if (state.background) {
        ctx.fillStyle = state.background;
        ctx.fillRect(x - 2, y - 2, wordWidth + 4, scaled + 4);
      }
      ctx.fillStyle = state.color;
      // A scaled word grows from its own baseline, not its top, or the line
      // visibly jumps as the highlight moves along it.
      ctx.fillText(words[i].word, x, y + (fontSize - scaled));
      x += wordWidth + spaceWidth;
    }
    ctx.restore();
  }

  async function drawClip(ctx, clip, trackType, props) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, props.opacity));
    // The clip's blend mode applies to ITS draw alone; the save/restore pair
    // hands the previous composite op back to the next clip, so transitions
    // (opacity/offset compositing in composeClipsAtPlayhead) are unaffected.
    ctx.globalCompositeOperation = clipCompositeOp(clip.blendMode);
    // Transition blur for the draw types that never touch ctx.filter (shape /
    // text / caption). The image/video path merges it into applyFilters
    // instead, which overrides this with the combined string — same pixels.
    if (props.blurPx > 0) ctx.filter = 'blur(' + props.blurPx.toFixed(1) + 'px)';
    const cx = props.x + props.width / 2;
    const cy = props.y + props.height / 2;
    ctx.translate(cx, cy);
    if (props.rotation) ctx.rotate((props.rotation * Math.PI) / 180);
    ctx.translate(-props.width / 2, -props.height / 2);

    if (trackType === 'shape') {
      drawShapeClip(ctx, clip, props);
    } else if (trackType === 'text') {
      drawTextClip(ctx, clip, props);
    } else if (trackType === 'caption') {
      await drawCaptionClip(ctx, clip, props, window.__CURRENT_TIME);
    } else {
      await drawImageOrVideoClip(ctx, clip, props, trackType);
    }
    ctx.restore();
  }

  async function preload() {
    // Videos are warmed up EAGERLY here, on every capture page: page setup runs
    // sequentially, and while a page is being set up it is the browser's
    // front-most (visible) page — the only state in which a new media pipeline
    // can be created. A <video> first created on a page that has been hidden
    // for a while never fetches a single byte (the request parks inside
    // Chromium's network stack: networkState=2, readyState=0 forever), so its
    // first seek wedges — the clip-boundary render failure seekVideo now fails
    // fast on. Seeks on an ALREADY-loaded element work fine while hidden, so
    // warming every clip during setup removes the whole class. Sequential
    // setup (see captureFrames) keeps the warmup RSS spike to one page.
    const promises = [];
    for (const track of output.tracks) {
      if (track.type === 'audio' || track.hidden) continue;
      for (const clip of track.clips) {
        if (!clip.src) continue;
        const isVideo = clip.type === 'video' || /\\.(mp4|webm|mov|mkv|avi)(\\?.*)?$/i.test(clip.src);
        if (isVideo) {
          promises.push(getVideo(clip.src).catch(() => null));
        } else promises.push(loadImage(clip.src).catch(() => null));
      }
    }
    await Promise.all(promises);
  }

  async function renderFrame(timeMs) {
    window.__CURRENT_TIME = timeMs;
    // Logical units — the renderScale transform maps them onto the device
    // pixels, so clear/fill/gradient/texture all span exactly the canvas.
    const logicalW = output.width;
    const logicalH = output.height;
    ctx.clearRect(0, 0, logicalW, logicalH);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = output.background || '#000000';
    ctx.fillRect(0, 0, logicalW, logicalH);

    if (output.bg && output.bg.type === 'image' && output.bg.src) {
      try {
        const img = await loadImage(output.bg.src);
        ctx.drawImage(img, 0, 0, logicalW, logicalH);
      } catch {}
    } else if (output.bg && output.bg.type === 'gradient' && output.bg.gradient) {
      // "stops", not "colors" — this read a field the schema has never had,
      // so a gradient background rendered as nothing at all. Angle honoured
      // the same way buildStyleGradient does: degrees, 0 = left to right.
      const stops = output.bg.gradient.stops || [];
      if (stops.length) {
        const angle = ((output.bg.gradient.angle || 0) * Math.PI) / 180;
        const hx = (Math.cos(angle) * logicalW) / 2;
        const hy = (Math.sin(angle) * logicalH) / 2;
        const cx = logicalW / 2;
        const cy = logicalH / 2;
        const grd = ctx.createLinearGradient(cx - hx, cy - hy, cx + hx, cy + hy);
        stops.forEach(function (s, i) {
          const offset = typeof s.offset === 'number'
            ? Math.max(0, Math.min(1, s.offset))
            : i / Math.max(1, stops.length - 1);
          grd.addColorStop(offset, s.color);
        });
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, logicalW, logicalH);
      }
    }

    // Texture is an overlay ON the base (shared generator, injected above), so
    // grain over a gradient keeps the gradient — same rule as the page render.
    if (output.bg && output.bg.texture) {
      drawTextureOverlay(ctx, output.bg.texture, logicalW, logicalH, function (w, h) {
        var tile = document.createElement('canvas');
        tile.width = w;
        tile.height = h;
        return tile;
      });
    }

    const composed = composeClipsAtPlayhead(output, timeMs);
    for (const item of composed) {
      // Motion blur is an accumulation: the same clip drawn at several
      // sub-frame times inside the shutter window, each at a fraction of the
      // opacity. A clip without it samples once and costs nothing extra.
      const times = motionBlurSampleTimes(timeMs, output.fps || 30, item.clip.motionBlur);
      if (times.length < 2) {
        await drawClip(ctx, item.clip, item.trackType, item.props);
        continue;
      }
      const wasTime = window.__CURRENT_TIME;
      // Accumulate the sub-frame samples ADDITIVELY at 1/N in an offscreen
      // buffer, then composite once. Drawing them onto the page with
      // source-over at opacity/N is not an average — overlapping samples
      // compound to 1-(1-o/N)^N (66% at N=8), darkening every blurred clip
      // against the already-painted background. Each sample also carries its
      // OWN keyframed opacity, not the playhead's. The buffer is sized in
      // DEVICE pixels (like the frame canvas) and drawn under the same
      // renderScale transform, so a supersampled export blurs at full
      // resolution; the composite maps it back onto the logical rect.
      const acc = document.createElement('canvas');
      acc.width = canvas.width;
      acc.height = canvas.height;
      const actx = acc.getContext('2d');
      actx.scale(renderScale, renderScale);
      actx.globalCompositeOperation = 'lighter';
      // The samples must accumulate additively, so the clip's blend mode is
      // neutralized inside the buffer and applied once to the composite below —
      // blending each sample instead would blend N ghosts against the page.
      const accClip = { ...item.clip, blendMode: undefined };
      for (const sampleMs of times) {
        window.__CURRENT_TIME = sampleMs;
        const relativeMs = Math.max(0, sampleMs - item.clip.startMs);
        const sampled = interpolateKeyframes(item.clip, relativeMs);
        await drawClip(
          actx,
          accClip,
          item.trackType,
          { ...sampled, opacity: (sampled.opacity == null ? 1 : sampled.opacity) / times.length }
        );
      }
      window.__CURRENT_TIME = wasTime;
      ctx.save();
      ctx.globalCompositeOperation = clipCompositeOp(item.clip.blendMode);
      ctx.drawImage(acc, 0, 0, logicalW, logicalH);
      ctx.restore();
    }
  }

  window.__FRAME_API = { preload, renderFrame };
})();
`;
