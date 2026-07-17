'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// One-at-a-time playback across every instance on the page.
let activeAudio: HTMLAudioElement | null = null;

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const PLAYED = '#2B5CD3'; // primary blue (progress)
const UNPLAYED = 'rgba(43, 92, 211, 0.35)'; // faded blue (remaining)

// Deterministic placeholder bars so a list renders instantly without decoding
// every track. Real peaks replace these lazily once the track is first played.
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const seeded = (n: number) => {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
};

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

interface AudioPlayerProps {
  src: string;
  /** Decode the real waveform only on first play (use in lists). */
  lazy?: boolean;
  height?: number;
  className?: string;
}

export const AudioPlayer: FC<AudioPlayerProps> = ({ src, lazy = false, height = 44, className }) => {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaksRef = useRef<number[] | null>(null);
  const decodedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const count = Math.max(1, Math.floor(w / (BAR_WIDTH + BAR_GAP)));
    const peaks = peaksRef.current;
    const base = hash(src);
    const progress = audio && audio.duration ? audio.currentTime / audio.duration : 0;

    for (let i = 0; i < count; i++) {
      const v = peaks
        ? peaks[Math.floor((i / count) * peaks.length)] ?? 0
        : 0.15 + seeded(base + i) * 0.85;
      const barH = Math.max(2, v * (h - 2));
      const x = i * (BAR_WIDTH + BAR_GAP);
      const y = (h - barH) / 2;
      ctx.fillStyle = i / count <= progress ? PLAYED : UNPLAYED;
      const r = BAR_WIDTH / 2;
      // rounded bar
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + BAR_WIDTH, y, x + BAR_WIDTH, y + barH, r);
      ctx.arcTo(x + BAR_WIDTH, y + barH, x, y + barH, r);
      ctx.arcTo(x, y + barH, x, y, r);
      ctx.arcTo(x, y, x + BAR_WIDTH, y, r);
      ctx.closePath();
      ctx.fill();
    }
  }, [src]);

  const decode = useCallback(async () => {
    if (decodedRef.current) return;
    decodedRef.current = true;
    // Cross-origin audio (Jamendo, etc.) can't be decoded without CORS headers —
    // keep the placeholder bars and skip the request to avoid console CORS noise.
    // Same-origin files (the user's uploads) decode into a real waveform.
    try {
      if (new URL(src, window.location.href).origin !== window.location.origin) return;
    } catch {
      return;
    }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AC();
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(buf);
      const data = decoded.getChannelData(0);
      const count = 256;
      const step = Math.floor(data.length / count) || 1;
      const peaks: number[] = [];
      let max = 0.0001;
      for (let i = 0; i < count; i++) {
        let peak = 0;
        for (let j = 0; j < step; j++) {
          const d = Math.abs(data[i * step + j] || 0);
          if (d > peak) peak = d;
        }
        peaks.push(peak);
        if (peak > max) max = peak;
      }
      peaksRef.current = peaks.map((p) => p / max);
      await audioCtx.close().catch(() => {});
      draw();
    } catch {
      // CORS / decode failure — keep placeholder bars; playback still works.
    }
  }, [src, draw]);

  useEffect(() => {
    const audio = new Audio();
    // No crossOrigin: a media element plays cross-origin audio (e.g. Jamendo)
    // fine without CORS; setting it would make the browser refuse to play.
    audio.src = src;
    audio.preload = 'metadata';
    audioRef.current = audio;
    decodedRef.current = false;
    peaksRef.current = null;

    const onMeta = () => setDur(audio.duration || 0);
    const onEnd = () => {
      setPlaying(false);
      setCur(0);
    };
    // Fires for both a user pause and when another instance pauses this one via
    // the module-level `activeAudio.pause()` — keeps the button/rAF loop in sync.
    const onPause = () => {
      setPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('pause', onPause);
    draw();
    if (!lazy) decode();

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('pause', onPause);
      if (activeAudio === audio) activeAudio = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [src, lazy, decode, draw]);

  // rAF progress loop, held in a ref so it can recurse without a TDZ self-reference.
  const loopRef = useRef<() => void>(() => {});
  useEffect(() => {
    loopRef.current = () => {
      const audio = audioRef.current;
      if (!audio) return;
      setCur(audio.currentTime);
      draw();
      rafRef.current = requestAnimationFrame(() => loopRef.current());
    };
  }, [draw]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      if (lazy) decode();
      audio.play().then(() => {
        setPlaying(true);
        rafRef.current = requestAnimationFrame(() => loopRef.current());
      }).catch(() => {});
    } else {
      // The 'pause' listener resets `playing` and cancels the rAF loop.
      audio.pause();
    }
  }, [lazy, decode]);

  const seek = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || !audio.duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setCur(audio.currentTime);
    draw();
  }, [draw]);

  return (
    <div className={`flex items-center gap-[10px] w-full ${className || ''}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('pause', 'Pause') : t('play', 'Play')}
        className="shrink-0 w-[34px] h-[34px] rounded-full bg-[#2B5CD3] text-white flex items-center justify-center hover:bg-[#2B5CD3]/85 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B5CD3]/50"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <canvas
        ref={canvasRef}
        onClick={seek}
        style={{ height }}
        className="flex-1 min-w-0 cursor-pointer"
      />
      <span className="shrink-0 text-[11px] tabular-nums text-newTextColor/60 w-[74px] text-right">
        {fmtTime(cur)} / {fmtTime(dur)}
      </span>
    </div>
  );
};

export default AudioPlayer;
