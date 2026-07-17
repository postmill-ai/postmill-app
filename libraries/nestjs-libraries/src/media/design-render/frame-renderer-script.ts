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

export const FRAME_RENDERER_SCRIPT = /* js */ `
(function () {
  const output = window.__DATA.output;
  const baseUrl = window.__DATA.baseUrl || '';
  const canvas = document.getElementById('frame-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = output.width;
  canvas.height = output.height;

  const imageCache = new Map();
  const videoCache = new Map();

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
      setTimeout(() => resolve(video), 5000);
    });
    videoCache.set(url, ready);
    return ready;
  }

  async function seekVideo(video, timeSec) {
    const target = Math.max(0, timeSec);
    if (Math.abs(video.currentTime - target) > 0.033) {
      await new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve(undefined);
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = target;
      });
    }
  }

  function mapFilterToken(token) {
    if (token === 'grayscale') return 'grayscale(100%)';
    if (token === 'sepia') return 'sepia(100%)';
    const [key, valueStr] = token.split(':');
    const value = parseFloat(valueStr);
    switch (key) {
      case 'blur': return \`blur(\${value || 0}px)\`;
      case 'brightness': return \`brightness(\${value == null ? 1 : value})\`;
      case 'contrast': return \`contrast(\${value == null ? 1 : value})\`;
      case 'saturate': return \`saturate(\${value == null ? 1 : value})\`;
      default: return '';
    }
  }

  function applyFilters(ctx, filters) {
    if (!filters || filters.length === 0) return;
    const str = filters.map(mapFilterToken).filter(Boolean).join(' ');
    if (str) ctx.filter = str;
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

  function interpolateKeyframes(clip, relativeMs) {
    const defaults = {
      x: clip.x || 0,
      y: clip.y || 0,
      width: clip.width || 1,
      height: clip.height || 1,
      rotation: clip.rotation || 0,
      opacity: clip.opacity == null ? 1 : clip.opacity,
    };
    const kfs = clip.keyframes || [];
    if (kfs.length === 0) return defaults;
    const sorted = [...kfs].sort((a, b) => a.tMs - b.tMs);
    if (relativeMs <= sorted[0].tMs) {
      const kf = sorted[0];
      return {
        x: kf.props.x == null ? defaults.x : kf.props.x,
        y: kf.props.y == null ? defaults.y : kf.props.y,
        width: kf.props.width == null ? defaults.width : kf.props.width,
        height: kf.props.height == null ? defaults.height : kf.props.height,
        rotation: kf.props.rotation == null ? defaults.rotation : kf.props.rotation,
        opacity: kf.props.opacity == null ? defaults.opacity : kf.props.opacity,
      };
    }
    if (relativeMs >= sorted[sorted.length - 1].tMs) {
      const kf = sorted[sorted.length - 1];
      return {
        x: kf.props.x == null ? defaults.x : kf.props.x,
        y: kf.props.y == null ? defaults.y : kf.props.y,
        width: kf.props.width == null ? defaults.width : kf.props.width,
        height: kf.props.height == null ? defaults.height : kf.props.height,
        rotation: kf.props.rotation == null ? defaults.rotation : kf.props.rotation,
        opacity: kf.props.opacity == null ? defaults.opacity : kf.props.opacity,
      };
    }
    let prev = sorted[0];
    let next = sorted[0];
    let ease = 'linear';
    for (let i = 0; i < sorted.length - 1; i++) {
      if (relativeMs >= sorted[i].tMs && relativeMs <= sorted[i + 1].tMs) {
        prev = sorted[i];
        next = sorted[i + 1];
        ease = next.ease || prev.ease || 'linear';
        break;
      }
    }
    const range = next.tMs - prev.tMs;
    let t = range > 0 ? (relativeMs - prev.tMs) / range : 0;
    if (ease === 'easeInOut') t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    else if (ease === 'easeIn') t = t * t;
    else if (ease === 'easeOut') t = 1 - (1 - t) * (1 - t);
    const lerp = (a, b, t) => a + (b - a) * t;
    return {
      x: lerp(prev.props.x == null ? defaults.x : prev.props.x, next.props.x == null ? defaults.x : next.props.x, t),
      y: lerp(prev.props.y == null ? defaults.y : prev.props.y, next.props.y == null ? defaults.y : next.props.y, t),
      width: lerp(prev.props.width == null ? defaults.width : prev.props.width, next.props.width == null ? defaults.width : next.props.width, t),
      height: lerp(prev.props.height == null ? defaults.height : prev.props.height, next.props.height == null ? defaults.height : next.props.height, t),
      rotation: lerp(prev.props.rotation == null ? defaults.rotation : prev.props.rotation, next.props.rotation == null ? defaults.rotation : next.props.rotation, t),
      opacity: lerp(prev.props.opacity == null ? defaults.opacity : prev.props.opacity, next.props.opacity == null ? defaults.opacity : next.props.opacity, t),
    };
  }

  function getClipDuration(clip) { return clip.endMs - clip.startMs; }
  function getEffectiveEnd(clip) { return clip.endMs + (clip.freezeAtMs || 0); }

  function sourceTimeForPlayhead(clip, playheadMs) {
    const effectiveEnd = getEffectiveEnd(clip);
    if (playheadMs < clip.startMs || playheadMs > effectiveEnd) return null;
    if (clip.freezeAtMs && playheadMs > clip.endMs) {
      return getClipDuration(clip) + (clip.trimInMs || 0);
    }
    let relativeMs = playheadMs - clip.startMs;
    if (clip.reverse) relativeMs = getClipDuration(clip) - relativeMs;
    if (clip.speed) relativeMs = relativeMs * clip.speed;
    return relativeMs + (clip.trimInMs || 0);
  }

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
      if (track.type === 'audio') continue;
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
          if (type === 'cut') {
            if (!isIncoming) props.opacity = 0;
          } else if (type === 'fade' || type === 'dissolve') {
            props.opacity *= isIncoming ? transitionProgress : (1 - transitionProgress);
          } else if (type === 'slide') {
            props.opacity *= isIncoming ? transitionProgress : (1 - transitionProgress);
            const direction = isIncoming ? (clip.transitionIn?.direction || 'left') : (clip.transitionOut?.direction || 'left');
            const offset = (isIncoming ? 1 - transitionProgress : transitionProgress) * (props.width || 1);
            if (direction === 'left') props.x -= offset;
            else if (direction === 'right') props.x += offset;
            else if (direction === 'up') props.y -= offset;
            else if (direction === 'down') props.y += offset;
          }
          props.opacity = Math.max(0, Math.min(1, props.opacity));
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
    const fitMode = clip.fitMode || 'contain';

    ctx.save();
    applyFilters(ctx, clip.filters);
    ctx.globalAlpha = props.opacity;

    if (fitMode === 'cover') {
      const { sx, sy, sw, sh } = computeCoverCrop(nw, nh, props.width, props.height, clip.focalPoint);
      ctx.drawImage(element, sx, sy, sw, sh, 0, 0, props.width, props.height);
    } else if (fitMode === 'fill') {
      ctx.drawImage(element, 0, 0, props.width, props.height);
    } else {
      const scale = Math.min(props.width / nw, props.height / nh, 1);
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

  function drawTextClip(ctx, clip, props) {
    const text = clip.text || '';
    if (!text) return;
    ctx.save();
    ctx.globalAlpha = props.opacity;
    const fontSize = clip.fontSize || 32;
    ctx.font = \`\${clip.fontWeight || 400} \${fontSize}px \${clip.fontFamily || 'sans-serif'}\`;
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
    ctx.font = \`\${fontWeight} \${fontSize}px \${clip.fontFamily || 'Arial'}\`;
    ctx.textBaseline = 'top';
    const lineHeight = fontSize * 1.35;
    const spaceWidth = ctx.measureText(' ').width;
    const relativeMs = Math.max(0, playheadMs - clip.startMs);
    let activeIndex = -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (relativeMs >= w.startMs && relativeMs <= w.endMs) {
        activeIndex = i;
        break;
      }
    }
    let x = 0;
    let y = 0;
    for (let i = 0; i < words.length; i++) {
      const wordWidth = ctx.measureText(words[i].word).width;
      if (x + wordWidth > props.width && x > 0) {
        x = 0;
        y += lineHeight;
      }
      ctx.fillStyle = i === activeIndex ? '#facc15' : (clip.fill || '#ffffff');
      ctx.fillText(words[i].word, x, y);
      x += wordWidth + spaceWidth;
    }
    ctx.restore();
  }

  async function drawClip(ctx, clip, trackType, props) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, props.opacity));
    const cx = props.x + props.width / 2;
    const cy = props.y + props.height / 2;
    ctx.translate(cx, cy);
    if (props.rotation) ctx.rotate((props.rotation * Math.PI) / 180);
    ctx.translate(-props.width / 2, -props.height / 2);

    if (trackType === 'text') {
      drawTextClip(ctx, clip, props);
    } else if (trackType === 'caption') {
      await drawCaptionClip(ctx, clip, props, window.__CURRENT_TIME);
    } else {
      await drawImageOrVideoClip(ctx, clip, props, trackType);
    }
    ctx.restore();
  }

  async function preload() {
    const promises = [];
    for (const track of output.tracks) {
      if (track.type === 'audio') continue;
      for (const clip of track.clips) {
        if (!clip.src) continue;
        const isVideo = clip.type === 'video' || /\\.(mp4|webm|mov|mkv|avi)(\\?.*)?$/i.test(clip.src);
        if (isVideo) promises.push(getVideo(clip.src).catch(() => null));
        else promises.push(loadImage(clip.src).catch(() => null));
      }
    }
    await Promise.all(promises);
  }

  async function renderFrame(timeMs) {
    window.__CURRENT_TIME = timeMs;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = output.background || '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (output.bg && output.bg.type === 'image' && output.bg.src) {
      try {
        const img = await loadImage(output.bg.src);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch {}
    } else if (output.bg && output.bg.type === 'gradient' && output.bg.gradient) {
      // Simple gradient support: top-to-bottom if colors provided
      const colors = output.bg.gradient.colors || [];
      if (colors.length) {
        const grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
        colors.forEach((c, i) => grd.addColorStop(i / Math.max(1, colors.length - 1), c));
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    const composed = composeClipsAtPlayhead(output, timeMs);
    for (const item of composed) {
      await drawClip(ctx, item.clip, item.trackType, item.props);
    }
  }

  window.__FRAME_API = { preload, renderFrame };
})();
`;
