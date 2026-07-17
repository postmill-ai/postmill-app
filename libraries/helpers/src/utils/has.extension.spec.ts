import { describe, it, expect } from 'vitest';
import { hasExtension } from './has.extension';

describe('hasExtension', () => {
  it('returns false for empty/null/undefined paths', () => {
    expect(hasExtension('', 'mp3')).toBe(false);
    expect(hasExtension(null, 'mp3')).toBe(false);
    expect(hasExtension(undefined, 'mp3')).toBe(false);
  });

  it('returns false when no extensions are supplied', () => {
    expect(hasExtension('file.mp3')).toBe(false);
  });

  it('detects a single extension with or without a leading dot', () => {
    expect(hasExtension('song.mp3', 'mp3')).toBe(true);
    expect(hasExtension('song.mp3', '.mp3')).toBe(true);
    expect(hasExtension('song.mp3', 'wav')).toBe(false);
  });

  it('detects any of several extensions', () => {
    expect(hasExtension('song.wav', 'mp3', 'wav', 'ogg', 'm4a')).toBe(true);
    expect(hasExtension('song.ogg', 'mp3', 'wav', 'ogg', 'm4a')).toBe(true);
    expect(hasExtension('song.m4a', 'mp3', 'wav', 'ogg', 'm4a')).toBe(true);
    expect(hasExtension('song.mp3', 'mp3', 'wav', 'ogg', 'm4a')).toBe(true);
    expect(hasExtension('song.flac', 'mp3', 'wav', 'ogg', 'm4a')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasExtension('song.MP3', 'mp3')).toBe(true);
    expect(hasExtension('song.MP3', '.mp3')).toBe(true);
    expect(hasExtension('song.WAV', 'mp3', 'wav')).toBe(true);
  });

  it('matches only the suffix, not a substring elsewhere in the path', () => {
    expect(hasExtension('mp3/song.png', 'mp3')).toBe(false);
    expect(hasExtension('folder.mp3/song.png', 'mp3')).toBe(false);
    expect(hasExtension('song.mp3?token=abc', 'mp3')).toBe(false);
    expect(hasExtension('song.mp3', 'mp3')).toBe(true);
  });
});
