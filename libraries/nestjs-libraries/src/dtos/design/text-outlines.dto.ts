import { IsBoolean, IsObject, IsOptional } from 'class-validator';

/**
 * Convert one text element to outlines.
 *
 * The element travels whole rather than by id: the caller may be converting an
 * unsaved edit, and the layout the outlines have to match is the one on screen.
 */
export class TextOutlinesDto {
  @IsObject()
  element!: Record<string, any>;

  /** One path per glyph (the default) rather than one per line. */
  @IsOptional()
  @IsBoolean()
  perGlyph?: boolean;
}
